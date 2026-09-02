import type { InitializeParams } from "./_generated/InitializeParams.ts";
import { CLIENT_INFO_NAME, CLIENT_INFO_VERSION } from "./backend-ops.ts";
import type { JsonRpcLiteClient } from "./client.ts";
import { CODEX_THREAD_CONFIG_OVERRIDES, DEFAULT_SANDBOX_MODE } from "./config.ts";

export interface CodexSessionInitOpts {
  agentId: string;
  cwd: string;
  systemPrompt: string;
  modelFamily: string;
  effort: string;
  permissionMode: string;
  sandbox?: string;
  env?: { [key: string]: string | undefined };
  resumeThreadId?: string;
  ephemeral?: boolean;
}

export async function bootstrapCodexThread(client: JsonRpcLiteClient, opts: CodexSessionInitOpts): Promise<string> {
  const initParams: InitializeParams = {
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
  };
  await client.initialize(initParams);

  if (opts.resumeThreadId) {
    const resumeResp = await client.request<{ thread: { id: string } }>("thread/resume", {
      threadId: opts.resumeThreadId,
      approvalPolicy: opts.permissionMode,
      sandbox: opts.sandbox ?? DEFAULT_SANDBOX_MODE,
      model: opts.modelFamily,
      developerInstructions: opts.systemPrompt,
      persistExtendedHistory: false,
      config: { ...CODEX_THREAD_CONFIG_OVERRIDES },
    });
    return resumeResp.thread.id;
  }

  const startResp = await client.request<{ thread: { id: string } }>("thread/start", buildThreadStartParams(opts));
  return startResp.thread.id;
}

function buildThreadStartParams(opts: CodexSessionInitOpts): Record<string, unknown> {
  const params: Record<string, unknown> = {
    cwd: opts.cwd,
    developerInstructions: opts.systemPrompt,
    model: opts.modelFamily,
    sandbox: opts.sandbox ?? DEFAULT_SANDBOX_MODE,
    approvalPolicy: opts.permissionMode,
    experimentalRawEvents: false,
    persistExtendedHistory: false,
    config: { ...CODEX_THREAD_CONFIG_OVERRIDES },
  };
  if (opts.ephemeral) params.ephemeral = true;
  if (opts.effort) params.reasoningEffort = opts.effort;
  return params;
}
