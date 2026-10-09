import type {
  Backend,
  BackendModel,
  BackendSession,
  CreateSessionOptions,
  ForkSessionBeforeMessageResult,
  ListModelsOptions,
  ModelOption,
  NormalizedMessage,
  OneShotOptions,
  PermissionModeOption,
} from "../types.ts";
import { AUTH_ERROR_PATTERNS, CAPABILITIES, DEFAULT_OPENCODE_MODEL, getOpenCodeLoginInstructions, MODEL_OPTIONS, OPENCODE_AUTH_FAILURE, permissionAgent, PERMISSION_MODES } from "./config.ts";
import { splitModel } from "./parse.ts";
import { OpenCodeBackendSession } from "./session.ts";
import { discoverOpenCodeModels, getSharedOpenCodeSupervisor, type OpenCodeSupervisor } from "./supervisor.ts";
import { OpenCodeTransport } from "./transport.ts";

const ONE_SHOT_TIMEOUT_MS = 30_000;

export interface OpenCodeBackendOptions {
  supervisor?: OpenCodeSupervisor;
  oneShotTimeoutMs?: number;
}

function productionModel(model: string): string {
  splitModel(model);
  return model;
}

export function createOpenCodeBackend(options: OpenCodeBackendOptions = {}): Backend {
  const bindings = new Map<string, { cwd: string; supervisor: OpenCodeSupervisor; model: string; agent?: string }>();

  const supervisorFor = (env?: { [key: string]: string | undefined }): OpenCodeSupervisor => {
    if (options.supervisor) return options.supervisor;
    return getSharedOpenCodeSupervisor(env);
  };

  const setBinding = (sessionId: string, binding: { cwd: string; supervisor: OpenCodeSupervisor; model: string; agent?: string }) => {
    bindings.set(sessionId, binding);
  };

  const transportForSession = (sessionId: string): OpenCodeTransport => {
    const binding = bindings.get(sessionId);
    if (!binding) throw new Error("OpenCode session is not bound to this Bureau process.");
    return new OpenCodeTransport({
      cwd: binding.cwd,
      model: binding.model,
      agent: binding.agent,
      supervisor: binding.supervisor,
      sessionId,
    });
  };

  return {
    capabilities: CAPABILITIES,

    getModelOptions(): ModelOption[] {
      return MODEL_OPTIONS;
    },

    getPermissionModes(): PermissionModeOption[] {
      return PERMISSION_MODES;
    },

    async listModels(opts: ListModelsOptions): Promise<BackendModel[]> {
      try {
        const models = await discoverOpenCodeModels(supervisorFor(opts.env), opts.cwd);
        if (models.length === 0) return staticBackendModels();
        return models.map(({ contextLimit: _c, isFree: _f, ...entry }) => ({
          ...entry,
        }));
      } catch {
        return staticBackendModels();
      }
    },

    createSession(opts: CreateSessionOptions): BackendSession {
      const model = productionModel(opts.modelFamily || DEFAULT_OPENCODE_MODEL);
      const supervisor = supervisorFor(opts.env);
      const agent = permissionAgent(opts.permissionMode);
      return new OpenCodeBackendSession(opts, model, supervisor, undefined, (sessionId) => setBinding(sessionId, { cwd: opts.cwd, supervisor, model, agent }));
    },

    resumeSession(sessionId: string, opts: CreateSessionOptions): BackendSession {
      const model = productionModel(opts.modelFamily || DEFAULT_OPENCODE_MODEL);
      const supervisor = supervisorFor(opts.env);
      const agent = permissionAgent(opts.permissionMode);
      setBinding(sessionId, { cwd: opts.cwd, supervisor, model, agent });
      return new OpenCodeBackendSession(opts, model, supervisor, sessionId, (resolved) => setBinding(resolved, { cwd: opts.cwd, supervisor, model, agent }));
    },

    checkSessionResumable(_sessionId: string, _opts: { cwd: string; env?: { [key: string]: string | undefined } }): string | null {
      // OpenCode sessions live in the local profile DB; optimistic resume — a
      // missing session surfaces as a turn failure rather than blocking start.
      return null;
    },

    async forkSessionBeforeMessage(sessionId: string, targetMessageId: string): Promise<ForkSessionBeforeMessageResult> {
      const parent = bindings.get(sessionId);
      if (!parent) return { kind: "fresh" };
      const transport = transportForSession(sessionId);
      try {
        const childId = await transport.forkAtMessage(targetMessageId);
        setBinding(childId, parent);
        return { kind: "fork", sessionId: childId, forkedFromSessionId: sessionId };
      } catch {
        return { kind: "fresh" };
      } finally {
        transport.close();
      }
    },

    async getSessionMessages(sessionId: string, cwd: string): Promise<NormalizedMessage[]> {
      const existing = bindings.get(sessionId);
      const supervisor = existing?.supervisor ?? supervisorFor();
      const model = existing?.model ?? DEFAULT_OPENCODE_MODEL;
      if (!existing) setBinding(sessionId, { cwd, supervisor, model });
      const transport = transportForSession(sessionId);
      try {
        return await transport.getSessionMessages();
      } finally {
        transport.close();
      }
    },

    async oneShotPrompt(prompt: string, opts: OneShotOptions): Promise<string> {
      const supervisor = supervisorFor(opts.env);
      let model = opts.modelFamily || DEFAULT_OPENCODE_MODEL;
      try {
        const discovered = await discoverOpenCodeModels(supervisor, opts.cwd ?? "/tmp");
        const free = discovered.filter((m) => m.isFree).sort((a, b) => a.id.localeCompare(b.id));
        const preferred = free.find((m) => m.id === model) ?? free[0];
        if (preferred) model = preferred.id;
      } catch {
        // keep static model
      }
      splitModel(model);
      const session = new OpenCodeBackendSession(
        {
          agentId: "bureau-opencode-one-shot",
          cwd: opts.cwd ?? "/tmp",
          systemPrompt: opts.systemPrompt ?? "",
          modelFamily: model,
          effort: "high",
          permissionMode: "bypassPermissions",
          env: opts.env,
        },
        model,
        supervisor,
      );
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const completion = (async () => {
          let text = "";
          for await (const event of session.stream()) {
            if (event.kind === "assistant_text") text += event.text;
            if (event.kind === "approval_request") {
              await session.approve(event.approvalId, { kind: "deny", reason: "One-shot prompts cannot run tools." });
            }
            if (event.kind === "turn_completed") {
              if (event.status !== "completed") throw new Error(event.error ?? "OpenCode one-shot prompt failed.");
              return text;
            }
          }
          throw new Error("OpenCode one-shot prompt ended without completion.");
        })();
        const run = Promise.all([session.send(prompt), completion]).then(([, text]) => text);
        return await Promise.race([
          run,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              void session.abort();
              reject(new Error("OpenCode one-shot prompt timed out."));
            }, options.oneShotTimeoutMs ?? ONE_SHOT_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
        session.close();
      }
    },

    detectAuthError(text: string): boolean {
      return AUTH_ERROR_PATTERNS.test(text) || text.includes(OPENCODE_AUTH_FAILURE);
    },

    getLoginInstructions(opts?: { env?: { [key: string]: string | undefined } }) {
      return getOpenCodeLoginInstructions(opts);
    },
  };
}

function staticBackendModels(): BackendModel[] {
  return MODEL_OPTIONS.map((m, i) => ({
    id: m.value,
    label: m.label,
    isDefault: i === 0,
    supportedEfforts: [],
  }));
}

export const opencodeBackend = createOpenCodeBackend();
