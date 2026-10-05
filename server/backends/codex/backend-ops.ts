import type { BackendEffortOption, BackendModel, ForkSessionBeforeMessageResult, ListModelsOptions, NormalizedMessage, OneShotOptions } from "../types.ts";

import { JsonRpcLiteClient } from "./client.ts";
import { CODEX_THREAD_CONFIG_OVERRIDES } from "./config.ts";
import { findTurnIndexContainingItemId, readThreadTurns } from "./thread-history.ts";

import type { Model as CodexProtocolModel } from "./_generated/v2/Model.ts";
import type { ModelListParams } from "./_generated/v2/ModelListParams.ts";
import type { ModelListResponse } from "./_generated/v2/ModelListResponse.ts";
import type { ThreadForkParams } from "./_generated/v2/ThreadForkParams.ts";

export const CLIENT_INFO_NAME = "bureau";
export const CLIENT_INFO_VERSION = "1.0.0";

export async function initializeCodexClient(client: JsonRpcLiteClient): Promise<void> {
  await client.initialize({
    clientInfo: {
      name: CLIENT_INFO_NAME,
      version: CLIENT_INFO_VERSION,
      title: null,
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
      optOutNotificationMethods: null,
    },
  });
}

function toBackendModel(m: CodexProtocolModel): BackendModel {
  const supportedEfforts: BackendEffortOption[] = (m.supportedReasoningEfforts ?? []).map((opt) => ({
    level: opt.reasoningEffort,
    description: opt.description,
  }));
  return {
    id: m.model,
    label: m.displayName || m.model,
    description: m.description || undefined,
    isDefault: m.isDefault,
    hidden: m.hidden,
    supportedEfforts,
    defaultEffort: m.defaultReasoningEffort,
  };
}

export async function listCodexModels(opts: ListModelsOptions): Promise<BackendModel[]> {
  const client = new JsonRpcLiteClient({ cwd: opts.cwd, env: opts.env });
  try {
    client.start();
    await initializeCodexClient(client);
    const collected: CodexProtocolModel[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 32; i++) {
      const params: ModelListParams = {
        cursor: cursor ?? null,
        limit: null,
        includeHidden: opts.includeHidden ?? false,
      };
      const resp = await client.request<ModelListResponse>("model/list", params);
      collected.push(...resp.data);
      if (!resp.nextCursor) break;
      cursor = resp.nextCursor;
    }
    return collected.map(toBackendModel);
  } finally {
    await client.close();
  }
}

export async function forkCodexSessionBeforeMessage(sessionId: string, targetMessageId: string): Promise<ForkSessionBeforeMessageResult> {
  const client = new JsonRpcLiteClient();
  try {
    client.start();
    await initializeCodexClient(client);

    const turns = await readThreadTurns(client, sessionId);
    const targetTurnIndex = findTurnIndexContainingItemId(turns, targetMessageId);
    if (targetTurnIndex === -1) {
      throw new Error("forkSessionBeforeMessage: target message not found in thread turns");
    }
    // The child ends before the turn holding the target message. Codex 0.160
    // has no thread/rollback, so the cut is made by the fork itself.
    const forkParams: ThreadForkParams = {
      threadId: sessionId,
      beforeTurnId: turns[targetTurnIndex]!.id,
      excludeTurns: true,
    };
    const forkResp = await client.request<{ thread: { id: string } }>("thread/fork", forkParams);
    const childThreadId = forkResp.thread.id;

    return {
      kind: "fork",
      sessionId: childThreadId,
      forkedFromSessionId: sessionId,
    };
  } finally {
    await client.close();
  }
}

export async function getCodexSessionMessages(sessionId: string): Promise<NormalizedMessage[]> {
  const client = new JsonRpcLiteClient();
  try {
    client.start();
    await initializeCodexClient(client);
    const turns = await readThreadTurns(client, sessionId);
    const out: NormalizedMessage[] = [];
    type ThreadItem = {
      type?: string;
      id?: string;
      content?: unknown;
      text?: string;
    };
    for (const turn of turns) {
      for (const raw of turn.items) {
        const item = raw as ThreadItem;
        if (item?.type === "userMessage" && typeof item.id === "string") {
          const text = Array.isArray(item.content)
            ? (item.content as { type?: string; text?: string }[])
                .filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
                .map((c) => c.text)
                .join("")
            : "";
          out.push({ uuid: item.id, role: "user", text });
        } else if (item?.type === "agentMessage" && typeof item.id === "string") {
          out.push({
            uuid: item.id,
            role: "assistant",
            text: item.text ?? "",
          });
        }
      }
    }
    return out;
  } finally {
    await client.close();
  }
}

export async function oneShotCodexPrompt(prompt: string, opts: OneShotOptions): Promise<string> {
  const client = new JsonRpcLiteClient({ cwd: opts.cwd, env: opts.env });
  try {
    client.start();
    await initializeCodexClient(client);
    const startResp = await client.request<{ thread: { id: string } }>("thread/start", {
      cwd: opts.cwd,
      model: opts.modelFamily,
      sandbox: "read-only",
      approvalPolicy: "never",
      ephemeral: true,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
      config: { ...CODEX_THREAD_CONFIG_OVERRIDES },
    });
    const threadId = startResp.thread.id;
    let result = "";
    let resolved = false;
    let failure: Error | null = null;
    const done = new Promise<void>((resolve) => {
      client.onNotification((n) => {
        const params = n.params as Record<string, unknown> | null | undefined;
        if (params?.threadId !== threadId) return;
        if (n.method === "item/completed") {
          const item = params?.item as { type?: string; text?: string } | undefined;
          if (item?.type === "agentMessage" && typeof item.text === "string") {
            result = item.text;
          }
        } else if (n.method === "turn/completed") {
          const turn = params?.turn as { status?: string; error?: { message?: string } | null } | undefined;
          if (turn?.status && turn.status !== "completed") {
            failure = new Error(`Codex one-shot turn ${turn.status}: ${turn.error?.message ?? "no detail"}`);
          }
          if (!resolved) {
            resolved = true;
            resolve();
          }
        } else if (n.method === "error") {
          const msg = params?.message;
          failure = new Error(`Codex one-shot error: ${typeof msg === "string" ? msg : "unknown"}`);
          if (!resolved) {
            resolved = true;
            resolve();
          }
        }
      });
    });
    await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
    });
    await done;
    try {
      await client.request("thread/archive", { threadId });
    } catch {}
    if (failure) throw failure as Error;
    return result;
  } finally {
    await client.close();
  }
}
