import { createHash } from "node:crypto";
import type { AgentInfo } from "../../../shared/types.ts";
import { getBackend } from "../../backends/index.ts";
import type { ListModelsOptions } from "../../backends/types.ts";
import { openCodeEnvironmentId } from "../../backends/opencode/profiles/identity.ts";
import { agents, emit, rooms, type ManagedAgent } from "../state.ts";
import { buildSessionEnv } from "../session/session-env.ts";
import { installModelAvailabilityRequests, modelCheckRevision } from "./activity.ts";
import { createModelAvailabilityRunner, type CapturedModelCheck } from "./runner.ts";

interface Dependencies {
  environment: (managed: ManagedAgent) => Record<string, string | undefined> | undefined;
  list: (options: ListModelsOptions) => Promise<readonly { id: string }[]>;
  missing: (info: AgentInfo, current: () => boolean) => void;
  error: () => void;
}

function capturedScope(info: AgentInfo, environment: Record<string, string | undefined> | undefined) {
  const env = { ...(environment ?? process.env) };
  delete env.BUREAU_AGENT_TOKEN;
  delete env.BUREAU_RUN_TOKEN;
  const environmentId = openCodeEnvironmentId(info.userId, rooms[info.room]?.id);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b))))
    .digest("hex");
  return { env, environmentId, scope: JSON.stringify([environmentId, info.cwd, fingerprint]) };
}

export function createModelMonitor(overrides: Partial<Dependencies> = {}) {
  let stopped = false;
  const deps: Dependencies = {
    environment: buildSessionEnv,
    list: (options) => getBackend("opencode").listModels(options),
    missing: (info, current) => {
      void import("./notification.ts")
        .then(({ notifyMissingModel }) => {
          if (current()) return notifyMissingModel(info);
        })
        .catch(() => deps.error());
    },
    error: () => console.error("Model availability check failed"),
    ...overrides,
  };
  const run = createModelAvailabilityRunner((agentId) => {
    const targets: CapturedModelCheck[] = [];
    for (const managed of agents.values()) {
      if (managed.info.agentType !== "opencode" || (agentId !== undefined && managed.info.id !== agentId)) continue;
      try {
        const info = { ...managed.info };
        const revision = modelCheckRevision(managed);
        const captured = capturedScope(info, deps.environment(managed));
        const current = () =>
          !stopped &&
          agents.get(info.id) === managed &&
          modelCheckRevision(managed) === revision &&
          managed.info.agentType === info.agentType &&
          managed.info.modelFamily === info.modelFamily &&
          capturedScope(managed.info, deps.environment(managed)).scope === captured.scope;
        targets.push({
          id: info.id,
          model: info.modelFamily,
          scope: captured.scope,
          current,
          list: () => deps.list({ cwd: info.cwd, env: { ...captured.env }, environmentId: captured.environmentId, requireLive: true }),
          apply: (missing) => {
            if ((managed.info.unavailableModel ?? null) === missing) return;
            managed.info.unavailableModel = missing;
            emit({ type: "agent_updated", agentId: info.id, changes: { unavailableModel: missing } });
            if (missing) deps.missing(info, () => current() && managed.info.unavailableModel === missing);
          },
        });
      } catch {
        deps.error();
      }
    }
    return targets;
  }, deps.error);
  return {
    run: (id?: string) => (stopped ? Promise.resolve() : run(id)),
    stop: () => {
      stopped = true;
    },
  };
}

export function startModelAvailabilityMonitor() {
  const monitor = createModelMonitor();
  const request = (id?: string) => {
    void monitor.run(id).catch(() => console.error("Model availability check failed"));
  };
  const restore = installModelAvailabilityRequests(request);
  const boot = setTimeout(request, 2 * 60_000);
  const daily = setInterval(request, 24 * 60 * 60_000);
  boot.unref();
  daily.unref();
  return () => {
    clearTimeout(boot);
    clearInterval(daily);
    restore();
    monitor.stop();
  };
}
