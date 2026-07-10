// Codex backend adapter.
//
// Implements the Backend contract (server/backends/types.ts) against the Codex
// App Server's JSON-RPC lite protocol via CodexSession.

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
import { forkCodexSessionBeforeMessage, getCodexSessionMessages, listCodexModels, oneShotCodexPrompt } from "./backend-ops.ts";
import { AUTH_ERROR_PATTERNS, CAPABILITIES, MODEL_OPTIONS, PERMISSION_MODES, getCodexLoginInstructions } from "./config.ts";
import { CodexSession } from "./session.ts";

export const codexBackend: Backend = {
  capabilities: CAPABILITIES,

  getModelOptions(): ModelOption[] {
    return MODEL_OPTIONS;
  },

  getPermissionModes(): PermissionModeOption[] {
    return PERMISSION_MODES;
  },

  async listModels(opts: ListModelsOptions): Promise<BackendModel[]> {
    return listCodexModels(opts);
  },

  createSession(opts: CreateSessionOptions): BackendSession {
    return new CodexSession({
      agentId: opts.agentId,
      cwd: opts.cwd,
      systemPrompt: opts.systemPrompt,
      modelFamily: opts.modelFamily,
      effort: opts.effort,
      permissionMode: opts.permissionMode,
      sandbox: opts.sandbox,
      env: opts.env,
    });
  },

  resumeSession(sessionId: string, opts: CreateSessionOptions): BackendSession {
    return new CodexSession({
      agentId: opts.agentId,
      cwd: opts.cwd,
      systemPrompt: opts.systemPrompt,
      modelFamily: opts.modelFamily,
      effort: opts.effort,
      permissionMode: opts.permissionMode,
      sandbox: opts.sandbox,
      env: opts.env,
      resumeThreadId: sessionId,
    });
  },

  async forkSessionBeforeMessage(sessionId: string, targetMessageId: string): Promise<ForkSessionBeforeMessageResult> {
    return forkCodexSessionBeforeMessage(sessionId, targetMessageId);
  },

  async getSessionMessages(sessionId: string): Promise<NormalizedMessage[]> {
    return getCodexSessionMessages(sessionId);
  },

  async oneShotPrompt(prompt: string, opts: OneShotOptions): Promise<string> {
    return oneShotCodexPrompt(prompt, opts);
  },

  detectAuthError(text: string): boolean {
    return AUTH_ERROR_PATTERNS.test(text);
  },

  getLoginInstructions(opts?: { env?: { [key: string]: string | undefined } }): { text: string; commands?: string[] } {
    return getCodexLoginInstructions(opts);
  },
};
