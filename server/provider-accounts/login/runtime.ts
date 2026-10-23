import { ProviderLoginManager } from "./manager.ts";
import { resolveAccountTarget } from "./targets.ts";
import { createCodexAccountClient } from "./codex-client.ts";
import { ClaudeAccountClient } from "./claude-client.ts";
import { providerHomes } from "../homes.ts";
import { invalidateProviderAccountCache } from "../status.ts";
import { listUsers } from "../../users.ts";
import { rooms } from "../../agents/state.ts";
import { memberUsageCap } from "../../usage-cap/member-usage-cap.ts";

export const providerLoginManager = new ProviderLoginManager({
  target: resolveAccountTarget,
  client: (target) => (target.provider === "claude" ? new ClaudeAccountClient(target.env) : createCodexAccountClient(target.env)),
  activate: (target, active) => {
    if (target.managed) providerHomes.setActive(target.userId, target.provider, active);
  },
  changed: (userId, provider, scope) => {
    if (scope === "office") {
      for (const user of listUsers(rooms)) invalidateProviderAccountCache(user.id);
      memberUsageCap().invalidate(provider);
    } else invalidateProviderAccountCache(userId);
  },
});
export function installProviderLoginShutdown() {
  process.once("exit", () => providerLoginManager.terminate());
}
