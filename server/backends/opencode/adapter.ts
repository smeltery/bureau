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
  SessionAccessOptions,
} from "../types.ts";
import { AUTH_ERROR_PATTERNS, CAPABILITIES, DEFAULT_OPENCODE_MODEL, getOpenCodeLoginInstructions, MODEL_OPTIONS, OPENCODE_AUTH_FAILURE, PERMISSION_MODES } from "./config.ts";
import { splitModel } from "./parse.ts";
import { OpenCodeBackendSession } from "./session.ts";
import { discoverOpenCodeModels, type OpenCodeSupervisor } from "./supervisor.ts";
import { OpenCodeProfiles, type ProfileBinding } from "./profiles/registry.ts";
import { OpenCodeTransport } from "./transport.ts";

const ONE_SHOT_TIMEOUT_MS = 30_000;

export interface OpenCodeBackendOptions {
  supervisor?: OpenCodeSupervisor;
  profiles?: OpenCodeProfiles;
  oneShotTimeoutMs?: number;
}

function productionModel(model: string): string {
  splitModel(model);
  return model;
}

export function createOpenCodeBackend(options: OpenCodeBackendOptions = {}): Backend {
  const profiles = options.profiles ?? (options.supervisor ? new OpenCodeProfiles(null, () => options.supervisor!) : new OpenCodeProfiles());
  const transportFor = (sessionId: string, binding: ProfileBinding) =>
    new OpenCodeTransport({
      cwd: binding.cwd,
      model: binding.model,
      agent: binding.agent,
      supervisor: binding.supervisor,
      resolveEnv: binding.resolveEnv,
      sessionId,
    });

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
        const models = await discoverOpenCodeModels(profiles.select(opts, DEFAULT_OPENCODE_MODEL).supervisor, opts.cwd, opts.env);
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
      const binding = profiles.session(opts, model);
      return new OpenCodeBackendSession(opts, model, binding.supervisor, undefined, (id) => profiles.bind(id, binding));
    },

    resumeSession(sessionId: string, opts: CreateSessionOptions): BackendSession {
      const model = productionModel(opts.modelFamily || DEFAULT_OPENCODE_MODEL);
      const binding = profiles.session(opts, model, sessionId);
      return new OpenCodeBackendSession(opts, model, binding.supervisor, sessionId, (id) => profiles.bind(id, binding));
    },

    checkSessionResumable(sessionId: string, opts: SessionAccessOptions): string | null {
      try {
        profiles.select(opts, DEFAULT_OPENCODE_MODEL, undefined, sessionId);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : "OpenCode session binding could not be read.";
      }
    },

    async forkSessionBeforeMessage(sessionId: string, targetMessageId: string, access?: SessionAccessOptions): Promise<ForkSessionBeforeMessageResult> {
      const binding = profiles.access(sessionId, access);
      const transport = transportFor(sessionId, binding);
      try {
        const childId = await transport.forkAtMessage(targetMessageId);
        profiles.bind(childId, binding);
        return { kind: "fork", sessionId: childId, forkedFromSessionId: sessionId };
      } finally {
        transport.close();
      }
    },

    async getSessionMessages(sessionId: string, cwd: string, access?: SessionAccessOptions): Promise<NormalizedMessage[]> {
      const binding = profiles.access(sessionId, access);
      const transport = transportFor(sessionId, { ...binding, cwd });
      try {
        return await transport.getSessionMessages();
      } finally {
        transport.close();
      }
    },

    async oneShotPrompt(prompt: string, opts: OneShotOptions): Promise<string> {
      const supervisor = profiles.select({ ...opts, cwd: opts.cwd ?? "/tmp" }, opts.modelFamily || DEFAULT_OPENCODE_MODEL).supervisor;
      let model = opts.modelFamily || DEFAULT_OPENCODE_MODEL;
      try {
        const discovered = await discoverOpenCodeModels(supervisor, opts.cwd ?? "/tmp", opts.env);
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

    getLoginInstructions(opts?: { env?: { [key: string]: string | undefined }; environmentId?: string; sessionId?: string }) {
      const binding = profiles.select({ ...opts, cwd: process.cwd() }, DEFAULT_OPENCODE_MODEL, undefined, opts?.sessionId);
      return getOpenCodeLoginInstructions({ ...opts, profileDir: binding.supervisor.profileDir });
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
