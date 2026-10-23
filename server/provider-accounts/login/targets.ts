import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { getOfficeSettings, rooms } from "../../agents/state.ts";
import { getUserById, listUsers } from "../../users.ts";
import { readEnvFile } from "../../persistence/env-file.ts";
import { BUREAU_CODEX_HOME } from "../../backends/codex/native-bin.ts";
import { isClaudeCloudSelected } from "../../backends/claude-install-check.ts";
import { canonicalProviderDirectory, providerHomes } from "../homes.ts";
import type { ProviderAccountProvider } from "../../../shared/provider-accounts.ts";
import { AccountError, type AccountScope, type AccountTarget, type AccountEnvironment } from "./types.ts";

const keyFor = (provider: ProviderAccountProvider) => (provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME");
const inside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return !path || (path !== ".." && !path.startsWith("../") && !isAbsolute(path));
};
export function resolveAccountTarget(userId: string, provider: ProviderAccountProvider, scope: AccountScope, create = false): AccountTarget {
  const user = getUserById(userId);
  if (!user) throw new AccountError("Member not found.", 401);
  const officeFile = getOfficeSettings().envFile;
  const office: AccountEnvironment = { ...process.env, ...(officeFile ? readEnvFile(officeFile) : {}) };
  const personal = user.envFile ? readEnvFile(user.envFile) : {};
  const key = keyFor(provider);
  const defaultDirectory = provider === "claude" ? join(office.HOME || homedir(), ".claude") : BUREAU_CODEX_HOME;
  const officeDirectory = office[key]?.trim() || defaultDirectory;
  const managed = scope === "personal" && !personal[key]?.trim();
  const directory = scope === "office" ? officeDirectory : managed ? providerHomes.home(userId, provider) : personal[key]!.trim();
  if (!isAbsolute(directory) || !isAbsolute(officeDirectory)) throw new AccountError(`${key} must name an absolute directory.`);
  const canonical = canonicalProviderDirectory(directory);
  if (scope === "office" && inside(canonicalProviderDirectory(providerHomes.base), canonical)) throw new AccountError("A managed personal directory cannot be used as the office account.", 409);
  if (scope === "personal") {
    const shared = canonicalProviderDirectory(officeDirectory);
    if (inside(shared, canonical) || inside(canonical, shared)) throw new AccountError("Personal sign-in needs a directory separate from the office account.", 409);
    const managedBase = canonicalProviderDirectory(providerHomes.base);
    if (inside(managedBase, canonical) && canonical !== canonicalProviderDirectory(providerHomes.home(userId, provider)))
      throw new AccountError("That managed directory belongs to another account.", 403);
    for (const member of listUsers(rooms)) {
      if (member.id === userId || !member.envFile) continue;
      const other = readEnvFile(member.envFile)[key]?.trim();
      if (other && (!isAbsolute(other) || inside(canonicalProviderDirectory(other), canonical) || inside(canonical, canonicalProviderDirectory(other))))
        throw new AccountError("Personal sign-in needs a directory unique to this member.", 409);
    }
  }
  const env: AccountEnvironment = { ...office, ...(scope === "personal" ? personal : {}), [key]: canonical };
  if (provider === "claude" && isClaudeCloudSelected(env)) throw new AccountError("This environment uses a cloud provider. Configure its credentials instead of browser sign-in.", 422);
  const apiKeyPresent = !!env[provider === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"]?.trim();
  // Account probes and login must inspect stored subscriptions even when an API key wins for agents.
  for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY", "BUREAU_AGENT_TOKEN"]) delete env[name];
  if (create && managed) providerHomes.ensure(userId, provider);
  return {
    provider,
    scope,
    userId,
    directory: canonical,
    key: `${provider}:${canonical}`,
    env,
    managed,
    available: existsSync(directory),
    apiKeyPresent,
    activePersonal: scope === "personal" && (!managed || providerHomes.active(userId, provider)),
  };
}
