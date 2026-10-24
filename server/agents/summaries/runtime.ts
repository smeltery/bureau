import { createHash } from "node:crypto";
import type { AgentInfo } from "../../../shared/types.ts";
import { getBackend } from "../../backends/index.ts";
import type { Backend, OneShotOptions } from "../../backends/types.ts";
import { openCodeEnvironmentId } from "../../backends/opencode/profiles/identity.ts";
import { getSessionClaudeConfigDir, getSessionCodexHome } from "../../persistence/logs/sessions.ts";
import { readSessionSummary, persistSessionSummary } from "../../persistence/logs/summary.ts";
import { buildSessionEnv } from "../session/session-env.ts";
import { rooms } from "../state.ts";
import { createSessionSummarizer, type SummaryDependencies } from "./summary.ts";

interface SummaryEnvironment {
  env: Record<string, string | undefined>;
  roomId?: string;
}
interface RunnerDependencies {
  backend: (type: AgentInfo["agentType"]) => Pick<Backend, "capabilities" | "getModelOptions" | "oneShotPrompt">;
  environment: (info: AgentInfo, sessionId: string) => SummaryEnvironment;
  read: SummaryDependencies["read"];
  write: SummaryDependencies["write"];
  onError: SummaryDependencies["onError"];
}

function captureEnvironment(info: AgentInfo, sessionId: string): SummaryEnvironment {
  const env = { ...(buildSessionEnv({ info }) ?? process.env) };
  // Read only: capturing an ended session must never recreate its metadata.
  const claudeHome = info.agentType === "claude" ? getSessionClaudeConfigDir(info.id, sessionId) : null;
  const codexHome = info.agentType === "codex" ? getSessionCodexHome(info.id, sessionId) : null;
  if (claudeHome) env.CLAUDE_CONFIG_DIR = claudeHome;
  if (codexHome) env.CODEX_HOME = codexHome;
  return { env, roomId: rooms[info.room]?.id };
}

/** Capture synchronously, then let ended sessions finish independently of their live agent. */
export function createSummaryRunner(overrides: Partial<RunnerDependencies> = {}) {
  const deps: RunnerDependencies = {
    backend: getBackend,
    environment: captureEnvironment,
    read: ({ agentId, sessionId }) => readSessionSummary(agentId, sessionId),
    write: ({ agentId, sessionId }, previous, summary, throughEntryId) => persistSessionSummary(agentId, sessionId, previous, summary, throughEntryId),
    onError: () => console.error("Conversation summary generation failed"),
    ...overrides,
  };
  const summarize = createSessionSummarizer(deps);
  return (managed: { info: AgentInfo }, sessionId: string): Promise<void> => {
    const info = { ...managed.info };
    const backend = deps.backend(info.agentType);
    if (!backend.capabilities.oneShot || !backend.capabilities.topicGen) return Promise.resolve();
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
    return summarize({
      agentId: info.id,
      sessionId,
      scope: JSON.stringify([info.agentType, modelFamily, environmentId, fingerprint]),
      generate: (prompt, systemPrompt) => backend.oneShotPrompt(prompt, { ...options, env: { ...env }, systemPrompt }),
    });
  };
}
