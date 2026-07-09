// Claude Code plugin management — the CLI's plugin ecosystem (skills, hooks,
// MCP servers installed via `claude plugin`), NOT bureau's in-process plugins
// (those live in shared/plugin-types.ts). Managed by shelling out to the
// headless CLI; see server/plugins/cc-plugins.ts.

export type CCPluginScope = "user" | "project" | "local" | "managed";

export interface CCInstalledPlugin {
  id: string; // "name@marketplace"
  name: string;
  marketplace: string;
  version: string;
  scope: CCPluginScope;
  /** Effective state: enabledPlugins[id] !== false in ~/.claude/settings.json.
   *  An absent entry means enabled-by-default, which the CLI's own `list`
   *  reports as false — we report what actually happens at session spawn. */
  enabled: boolean;
  description?: string;
  installedAt?: string; // ISO 8601
  lastUpdated?: string; // ISO 8601
}

export interface CCAvailablePlugin {
  id: string; // "name@marketplace"
  name: string;
  marketplace: string;
  description?: string;
  version?: string;
  installCount?: number;
  installed: boolean;
}

export interface CCMarketplace {
  name: string;
  source: string; // "github" | "url" | local path kinds
  repo?: string; // owner/repo when source === "github"
  url?: string;
}

export interface CCPluginsState {
  installed: CCInstalledPlugin[];
  available: CCAvailablePlugin[];
  marketplaces: CCMarketplace[];
  fetchedAt: number; // ms epoch of the CLI read backing this snapshot
}
