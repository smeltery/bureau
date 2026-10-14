import { enableMcpOAuth } from "./oauth/runtime.ts";
import { agents, addLogEntry } from "../agents/state.ts";
import { createSession, replaceSession, SessionSwappedError } from "../agents/session/runtime.ts";
import type { ManagedAgent } from "../agents/state-types.ts";
import { onIntegrationChange } from "./changes.ts";
import { credentialRuntime } from "./proxy/runtime.ts";

let enabled = false;
export async function enableIntegrations(): Promise<void> {
  if (enabled) return;
  enabled = true;
  onIntegrationChange(async (scope) => {
    for (const managed of agents.values()) {
      if (scope.kind === "office" || managed.info.userId === scope.userId) managed.integrationRevision = (managed.integrationRevision ?? 0) + 1;
    }
    await credentialRuntime.refresh();
  });
  const started = await Promise.allSettled([credentialRuntime.enable(), enableMcpOAuth()]);
  if (started.some((result) => result.status === "rejected")) throw new Error("Some integration services could not start.");
}

export async function refreshAgentIntegrations(managed: ManagedAgent): Promise<void> {
  const revision = managed.integrationRevision ?? 0;
  if (revision === (managed.appliedIntegrationRevision ?? 0) || !managed.session) return;
  if (managed.pendingTurn) throw new Error("An integration refresh must wait for the current turn.");
  const token = managed.turnCancelToken;
  const replacement = createSession(managed, managed.sessionId ?? undefined);
  await replaceSession(managed.info.id, managed, replacement);
  if (agents.get(managed.info.id) !== managed || managed.turnCancelToken !== token + 1) throw new SessionSwappedError();
  managed.appliedIntegrationRevision = revision;
  managed.wakeNotice = [managed.wakeNotice, "Your integrations changed. Bureau restarted this session to load the current connections and credentials."].filter(Boolean).join("\n");
  addLogEntry(managed.info.id, "system", "Integrations updated; the next turn uses the current configuration.");
}
