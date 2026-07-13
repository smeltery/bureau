/**
 * Claude Code plugin management — wraps the headless `claude plugin` CLI.
 *
 * This manages the CLI's plugin ecosystem (skills, hooks, MCP servers from
 * marketplaces), which agents inherit because the SDK spawns CLI subprocesses.
 * It is unrelated to bureau's in-process plugins (registry.ts).
 *
 * Why the CLI and not direct file writes: install/uninstall do git clones,
 * cache layout, and lockfile bookkeeping that the CLI owns. Re-implementing
 * that invites drift; shelling out keeps one writer. Reads also go through
 * `claude plugin list --available --json` so the catalog matches exactly what
 * the CLI would show — except the effective enabled bit, which we compute from
 * settings.json because the CLI's `enabled` field only reflects an *explicit*
 * settings entry (absent means enabled-by-default at session spawn).
 *
 * All CLI invocations are serialized through a single promise chain. The CLI
 * read-modify-writes installed_plugins.json and settings.json; two concurrent
 * mutations could drop each other's writes.
 *
 * See docs/features/plugin-management-design.md.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { CCAvailablePlugin, CCInstalledPlugin, CCMarketplace, CCPluginScope, CCPluginsState, ServerMessage } from "../../shared/types.ts";
import { broadcast } from "../ws/broadcast.ts";
import { CCPluginError, LIST_TIMEOUT_MS, MUTATION_TIMEOUT_MS, assertSafeCliArg, cliFailureMessage, runCli } from "./cc-plugin-cli.ts";

const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");

// Serve the cached snapshot for this long unless a caller forces a refresh.
// Mutations always refresh. The catalog only changes when this process (or a
// CLI session the user runs by hand) changes it, so staleness risk is low.
const CACHE_TTL_MS = 60_000;

export { CCPluginError };

let cachedState: CCPluginsState | null = null;

// ---------------------------------------------------------------------------
// State reads
// ---------------------------------------------------------------------------

/** Effective enabled map from settings.json. Absent entry → enabled. The
 *  CLI consults the same file at session spawn, so this matches what agents
 *  actually load. Project/local-scope overrides aren't visible here; bureau
 *  manages plugins at user scope. */
function readEnabledMap(): Record<string, boolean> {
  const settingsPath = join(CLAUDE_CONFIG_DIR, "settings.json");
  if (!existsSync(settingsPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as { enabledPlugins?: Record<string, boolean> };
    return parsed.enabledPlugins ?? {};
  } catch {
    return {};
  }
}

interface CliInstalledEntry {
  id: string;
  version?: string;
  scope?: string;
  installPath?: string;
  installedAt?: string;
  lastUpdated?: string;
}

/** Description fallback for installed plugins whose marketplace catalog entry
 *  is missing (e.g. the marketplace was removed or its index changed): read
 *  the cached `.claude-plugin/plugin.json` from the install path. */
function readInstalledDescription(installPath: string | undefined): string | undefined {
  if (!installPath) return undefined;
  const manifestPath = join(installPath, ".claude-plugin", "plugin.json");
  if (!existsSync(manifestPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { description?: unknown };
    return typeof parsed.description === "string" ? parsed.description : undefined;
  } catch {
    return undefined;
  }
}

interface CliAvailableEntry {
  pluginId: string;
  name?: string;
  description?: string;
  marketplaceName?: string;
  version?: string;
  installCount?: number;
}

async function fetchState(): Promise<CCPluginsState> {
  const listRes = await runCli(["plugin", "list", "--available", "--json"], LIST_TIMEOUT_MS);
  if (listRes.exitCode !== 0) throw new CCPluginError(cliFailureMessage("plugin list", listRes));
  const marketsRes = await runCli(["plugin", "marketplace", "list", "--json"], LIST_TIMEOUT_MS);
  if (marketsRes.exitCode !== 0) throw new CCPluginError(cliFailureMessage("marketplace list", marketsRes));

  let parsed: { installed?: CliInstalledEntry[]; available?: CliAvailableEntry[] };
  let markets: Array<{ name: string; source?: string; repo?: string; url?: string }>;
  try {
    parsed = JSON.parse(listRes.stdout);
    markets = JSON.parse(marketsRes.stdout);
  } catch (err) {
    throw new CCPluginError(`failed to parse CLI JSON output: ${err instanceof Error ? err.message : String(err)}`);
  }

  const enabledMap = readEnabledMap();
  const availableById = new Map<string, CliAvailableEntry>();
  for (const a of parsed.available ?? []) availableById.set(a.pluginId, a);

  const installed: CCInstalledPlugin[] = (parsed.installed ?? []).map((p) => {
    const [name = p.id, marketplace = ""] = p.id.split("@");
    return {
      id: p.id,
      name,
      marketplace,
      version: p.version ?? "",
      scope: (p.scope ?? "user") as CCPluginScope,
      enabled: enabledMap[p.id] !== false,
      description: availableById.get(p.id)?.description ?? readInstalledDescription(p.installPath),
      installedAt: p.installedAt,
      lastUpdated: p.lastUpdated,
    };
  });
  const installedIds = new Set(installed.map((p) => p.id));

  const available: CCAvailablePlugin[] = (parsed.available ?? []).map((a) => ({
    id: a.pluginId,
    name: a.name ?? a.pluginId.split("@")[0] ?? a.pluginId,
    marketplace: a.marketplaceName ?? a.pluginId.split("@")[1] ?? "",
    description: a.description,
    version: a.version,
    installCount: a.installCount,
    installed: installedIds.has(a.pluginId),
  }));

  const marketplaces: CCMarketplace[] = markets.map((m) => ({
    name: m.name,
    source: m.source ?? "unknown",
    repo: m.repo,
    url: m.url,
  }));

  return { installed, available, marketplaces, fetchedAt: Date.now() };
}

export async function getCCPluginsState(opts?: { refresh?: boolean }): Promise<CCPluginsState> {
  if (!opts?.refresh && cachedState && Date.now() - cachedState.fetchedAt < CACHE_TTL_MS) {
    return cachedState;
  }
  cachedState = await fetchState();
  return cachedState;
}

/** Re-read state and push it to every connected browser. Called after every
 *  mutation so all open Plugin panels converge without polling. */
async function refreshAndBroadcast(): Promise<CCPluginsState> {
  cachedState = await fetchState();
  broadcast({ type: "cc_plugins_state", plugins: cachedState } satisfies ServerMessage);
  return cachedState;
}

// ---------------------------------------------------------------------------
// Mutations — each shells out, then refreshes + broadcasts
// ---------------------------------------------------------------------------

const VALID_SCOPES: CCPluginScope[] = ["user", "project", "local"];

export async function installCCPlugin(plugin: string, scope?: string): Promise<CCPluginsState> {
  assertSafeCliArg(plugin, "plugin name");
  const resolvedScope = scope ?? "user";
  if (!VALID_SCOPES.includes(resolvedScope as CCPluginScope)) {
    throw new CCPluginError(`invalid scope "${resolvedScope}" — must be user, project, or local`);
  }
  const res = await runCli(["plugin", "install", plugin, "--scope", resolvedScope], MUTATION_TIMEOUT_MS);
  if (res.exitCode !== 0) throw new CCPluginError(cliFailureMessage(`install ${plugin}`, res));
  return refreshAndBroadcast();
}

export async function uninstallCCPlugin(plugin: string): Promise<CCPluginsState> {
  assertSafeCliArg(plugin, "plugin name");
  const res = await runCli(["plugin", "uninstall", plugin], MUTATION_TIMEOUT_MS);
  if (res.exitCode !== 0) throw new CCPluginError(cliFailureMessage(`uninstall ${plugin}`, res));
  return refreshAndBroadcast();
}

export async function enableCCPlugin(plugin: string): Promise<CCPluginsState> {
  assertSafeCliArg(plugin, "plugin name");
  const res = await runCli(["plugin", "enable", plugin], MUTATION_TIMEOUT_MS);
  if (res.exitCode !== 0) throw new CCPluginError(cliFailureMessage(`enable ${plugin}`, res));
  return refreshAndBroadcast();
}

export async function disableCCPlugin(plugin: string): Promise<CCPluginsState> {
  assertSafeCliArg(plugin, "plugin name");
  const res = await runCli(["plugin", "disable", plugin], MUTATION_TIMEOUT_MS);
  if (res.exitCode !== 0) throw new CCPluginError(cliFailureMessage(`disable ${plugin}`, res));
  return refreshAndBroadcast();
}

export async function updateCCPlugin(plugin: string): Promise<CCPluginsState> {
  assertSafeCliArg(plugin, "plugin name");
  const res = await runCli(["plugin", "update", plugin], MUTATION_TIMEOUT_MS);
  if (res.exitCode !== 0) throw new CCPluginError(cliFailureMessage(`update ${plugin}`, res));
  return refreshAndBroadcast();
}

export async function addCCMarketplace(source: string): Promise<CCPluginsState> {
  assertSafeCliArg(source, "marketplace source");
  const res = await runCli(["plugin", "marketplace", "add", source], MUTATION_TIMEOUT_MS);
  if (res.exitCode !== 0) throw new CCPluginError(cliFailureMessage(`marketplace add ${source}`, res));
  return refreshAndBroadcast();
}

export async function removeCCMarketplace(name: string): Promise<CCPluginsState> {
  assertSafeCliArg(name, "marketplace name");
  const res = await runCli(["plugin", "marketplace", "remove", name], MUTATION_TIMEOUT_MS);
  if (res.exitCode !== 0) throw new CCPluginError(cliFailureMessage(`marketplace remove ${name}`, res));
  return refreshAndBroadcast();
}
