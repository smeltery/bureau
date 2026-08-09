// The production wiring for the /api/apps routes: the real registry, the real
// systemd supervisor, the real token store and rate limiter. Split from apps.ts
// so the handler file imports only the SEAM (AppsDeps) and a test can inject
// fakes without the module graph pulling in the agent manager or systemd.

import * as AgentManager from "../agent-manager.ts";
import { appRegistry } from "../apps/registry.ts";
import { appSupervisor } from "../apps/supervisor.ts";
import { appTokens } from "../apps/tokens.ts";
import { appMessageLimiter } from "../apps/message-limits.ts";
import type { AppsDeps } from "./apps-seam.ts";

export const defaultAppsDeps: AppsDeps = {
  registry: appRegistry,
  states: (names) => appSupervisor.states(names),
  install: (record) => appSupervisor.install(record),
  reinstall: (record) => appSupervisor.reinstall(record),
  teardown: (name) => appSupervisor.teardown(name),
  start: (name) => appSupervisor.start(name),
  stop: (name) => appSupervisor.stop(name),
  restart: (name) => appSupervisor.restart(name),
  logs: (name, lines) => appSupervisor.logs(name, lines),
  provisionToken: (record) => provisionAppToken(record.name, record.userId),
  revokeToken: (name) => appTokens.revoke(name),
  sendAsApp: (appName, targetAgentId, text) => {
    const result = AgentManager.enqueueMessage(targetAgentId, { sender: { kind: "app", appName }, text });
    if (result.ok) return { ok: true, messageId: result.messageId, queued: result.queued };
    return { ok: false, status: result.status, code: result.status === 404 ? "not_found" : "send_failed", message: result.error };
  },
  limiter: appMessageLimiter,
  // App-host arm lands later: no app hostnames yet.
  publicUrl: () => null,
};

// Mint + persist + write the plaintext, as one step whose halves cannot come
// apart. Never throws: see AppsDeps.provisionToken.
function provisionAppToken(name: string, userId: string | null): boolean {
  let raw: string;
  try {
    raw = appTokens.mint(name, userId);
  } catch (err) {
    console.error(`[apps] "${name}" could not be given a token:`, err);
    return false;
  }
  try {
    appSupervisor.provisionToken(name, raw);
    return true;
  } catch (err) {
    // The plaintext never reached the app, so the hash is a credential nothing
    // can present. Revoked rather than left behind.
    console.error(`[apps] "${name}" token was minted but not delivered; revoking:`, err);
    try {
      appTokens.revoke(name);
    } catch (revokeErr) {
      console.error(`[apps] "${name}" token hash could not be revoked after a failed delivery:`, revokeErr);
    }
    return false;
  }
}
