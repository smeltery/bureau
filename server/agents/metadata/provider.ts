import { createHash } from "node:crypto";
import type { AgentInfo } from "../../../shared/types.ts";
import { getBackend } from "../../backends/index.ts";
import type { Backend, OneShotOptions } from "../../backends/types.ts";
import { openCodeEnvironmentId } from "../../backends/opencode/profiles/identity.ts";
import { getSessionClaudeConfigDir, getSessionCodexHome } from "../../persistence/logs/sessions.ts";
import { buildSessionEnv } from "../session/session-env.ts";
import { rooms } from "../state.ts";

interface MetadataEnvironment {
  env: Record<string, string | undefined>;
  roomId?: string;
}
export interface MetadataProviderDependencies {
  backend: (type: AgentInfo["agentType"]) => Pick<Backend, "capabilities" | "getModelOptions" | "oneShotPrompt"> & Partial<Pick<Backend, "detectAuthError">>;
  environment: (info: AgentInfo, sessionId: string) => MetadataEnvironment;
}

function captureEnvironment(info: AgentInfo, sessionId: string): MetadataEnvironment {
  const env = { ...(buildSessionEnv({ info }) ?? process.env) };
  // Read only: capturing an ended session must never recreate its metadata.
  const claudeHome = sessionId && info.agentType === "claude" ? getSessionClaudeConfigDir(info.id, sessionId) : null;
  const codexHome = sessionId && info.agentType === "codex" ? getSessionCodexHome(info.id, sessionId) : null;
  if (claudeHome) env.CLAUDE_CONFIG_DIR = claudeHome;
  if (codexHome) env.CODEX_HOME = codexHome;
  return { env, roomId: rooms[info.room]?.id };
}

export function captureMetadataProvider(agent: AgentInfo, sessionId: string, overrides: Partial<MetadataProviderDependencies> = {}) {
  const deps: MetadataProviderDependencies = { backend: getBackend, environment: captureEnvironment, ...overrides };
  const info = { ...agent };
  const backend = deps.backend(info.agentType);
  if (!backend.capabilities.oneShot || !backend.capabilities.topicGen) return null;
  const captured = deps.environment(info, sessionId);
  const env = { ...captured.env };
  delete env.BUREAU_AGENT_TOKEN;
  delete env.BUREAU_RUN_TOKEN;
  const modelFamily = info.agentType === "claude" ? "sonnet" : info.agentType === "codex" ? (backend.getModelOptions()[0]?.value ?? info.modelFamily) : info.modelFamily;
  const environmentId = openCodeEnvironmentId(info.userId, captured.roomId);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b))))
    .digest("hex");
  const options: OneShotOptions = { modelFamily, environmentId, env, cwd: "/tmp" };
  return {
    scope: JSON.stringify([info.agentType, modelFamily, environmentId, fingerprint]),
    generate: (prompt: string, systemPrompt: string) => backend.oneShotPrompt(prompt, { ...options, env: { ...env }, systemPrompt }),
    isAuthError: (error: unknown) => backend.detectAuthError?.(error instanceof Error ? error.message : String(error)) ?? false,
  };
}
