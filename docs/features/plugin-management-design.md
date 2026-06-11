# Plugin Management UI — Design Doc

## Status: Implemented

Shipped as the **Plugins** panel (office toolbar). Server: `server/plugins/cc-plugins.ts`
(headless CLI wrapper) + `server/http/plugins.ts` (routes). UI:
`ui/components/PluginsView.tsx`. State broadcast: `cc_plugins_state` server
message. Implementation deltas from the original plan are noted inline below.

## Context

Claude Code plugins are bundles of skills, commands, hooks, MCP servers, and
subagent definitions installed via `/plugin add`. The `/plugin` command is a
local-JSX (Ink/React) UI rendered entirely client-side in the CLI — no SDK
events are emitted, so Bureau cannot forward or intercept it.

**Current state:** Bureau already discovers plugin skills from
`~/.claude/plugins/installed_plugins.json` and surfaces them in autocomplete.
Plugin skills, hooks, and MCP servers work transparently because they're loaded
by the CLI subprocess. The only gap is the management UI (install, remove,
enable, disable, browse marketplace).

**Interim solution (superseded):** `/plugin` used to direct users to the
built-in terminal; it now points at the Plugins panel.

## Design: Hybrid Web UI + Headless CLI

### Principle

Use the existing headless CLI commands for mutations. Build a lightweight web UI
for browsing and status display. Don't report the Ink component tree.

### Architecture

```
┌─────────────────────────────────────────┐
│  Bureau Web UI (Plugin Manager panel)   │
│                                         │
│  ┌─────────┐  ┌──────────┐  ┌────────┐ │
│  │Installed │  │Discover  │  │Markets │ │
│  │ tab      │  │ tab      │  │ tab    │ │
│  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│       │              │            │      │
└───────┼──────────────┼────────────┼──────┘
        │              │            │
        ▼              ▼            ▼
  ┌──────────────────────────────────────┐
  │  Bureau Server (plugin routes)       │
  │                                      │
  │  GET /api/plugins         → read     │
  │  POST /api/plugins/install   → CLI   │
  │  POST /api/plugins/remove    → CLI   │
  │  POST /api/plugins/enable    → CLI   │
  │  POST /api/plugins/disable   → CLI   │
  │  GET /api/plugins/marketplace → read │
  │  POST /api/plugins/marketplace/add   │
  └──────────────────────────────────────┘
        │
        ▼
  ┌──────────────────────────────────────┐
  │  Headless CLI (subprocess)           │
  │                                      │
  │  claude plugin install <name>        │
  │  claude plugin remove <name>         │
  │  claude plugin enable <name>         │
  │  claude plugin disable <name>        │
  │  claude plugin marketplace add o/r   │
  └──────────────────────────────────────┘
```

### Data Sources

**As implemented:** all reads go through `claude plugin list --available --json`
(one call returns installed + the full marketplace catalog, with descriptions
and install counts) and `claude plugin marketplace list --json`, so the catalog
matches exactly what the CLI would show. Results are cached for 60s; the panel's
Refresh button bypasses the cache. The one exception is the effective enabled
bit (see "Enabled state" below). The file formats below are kept for reference.

**Installed plugins** — read directly from
`~/.claude/plugins/installed_plugins.json` (V2 format):

```json
{
  "version": 2,
  "plugins": {
    "plugin-name@marketplace": [{
      "scope": "user|project|local|managed",
      "installPath": "/path/to/cache",
      "version": "1.0.0",
      "installedAt": "ISO 8601",
      "lastUpdated": "ISO 8601"
    }]
  }
}
```

**Plugin metadata** — read `.claude-plugin/plugin.json` from each
`installPath` for name, description, version, author, components.

**Enabled state** — read from `~/.claude/settings.json` →
`enabledPlugins` map. Note: an *absent* entry means enabled-by-default at
session spawn, but `claude plugin list --json` reports `enabled: false` for it
(the field only reflects an explicit settings entry). The server therefore
computes the effective state itself: `enabledPlugins[id] !== false`.

**Marketplace catalog** — resolved: `claude plugin list --available --json`
returns the merged catalog from all configured marketplaces, including
descriptions and install counts. No scraping needed.

### Server Endpoints

Implemented under `/plugins` (no `/api` prefix, matching the tasks/cronjobs
APIs; auth enforced upstream in `server/index.ts`, loopback-allowed so agents
can use it too):

| Endpoint | Method | Action |
|---|---|---|
| `/plugins` | GET | Full snapshot: installed + available + marketplaces (`?refresh=1` bypasses cache) |
| `/plugins/install` | POST | `claude plugin install <name> --scope <scope>` |
| `/plugins/remove` | POST | `claude plugin uninstall <name>` |
| `/plugins/enable` | POST | `claude plugin enable <name>` |
| `/plugins/disable` | POST | `claude plugin disable <name>` |
| `/plugins/update` | POST | `claude plugin update <name>` |
| `/plugins/marketplace/add` | POST | `claude plugin marketplace add <source>` |
| `/plugins/marketplace/remove` | POST | `claude plugin marketplace remove <name>` |

All mutation endpoints shell out to the headless CLI (async `Bun.spawn`,
serialized through a single queue so concurrent mutations can't interleave
the CLI's read-modify-writes) and return the refreshed snapshot. After each
mutation the server also broadcasts `cc_plugins_state` to all browsers.
Mutation bodies are `{ plugin, scope? }` / `{ source }` / `{ name }`; values
are validated against a conservative character set to rule out flag injection.

### Web UI

A modal or sidebar panel accessible from the office toolbar. Three tabs:

**Installed** — table of installed plugins showing name, version, scope,
enabled state, and action buttons (enable/disable/remove).

**Discover** — search and browse available plugins from configured
marketplaces. Install button per plugin with scope picker.

**Marketplaces** — list configured marketplace repos. Add/remove buttons.

### Post-Install Agent Refresh

After installing or enabling a plugin, the server needs to trigger a reload
on affected agents. Options:

1. Send `/reload-plugins` as a message to the agent's session (if the
   command is SDK-reported)
2. Recreate the agent's session (heavier but guaranteed)
3. Notify the user to manually reload

Option 1 is preferred. The server can check if `reload-plugins` is in the
agent's `sdkReportedCommands` and auto-send it.

**As implemented:** option 3. `/reload-plugins` is not SDK-reported in bureau
sessions, so the panel surfaces a note after install/enable: running agents
pick the plugin up on their next session (restart or `/resume`); fresh spawns
get it automatically.

### Scope

Plugins can be installed at multiple scopes:
- **user** — global, applies to all projects
- **project** — per-project, shared with team via `.claude/settings.json`
- **local** — per-project, personal override

The UI should default to `user` scope and allow override.

### Security Considerations

- Plugin install runs arbitrary CLI code (git clone, npm install). The
  headless CLI handles this safely already.
- Marketplace trust: only official + user-added marketplaces.
- No process-level sandboxing exists in CC — same applies here.

### What This Doesn't Cover

- Building a plugin marketplace browser/search from scratch
- Plugin hook management UI (hooks fire transparently via CLI)
- LSP server management (handled by CLI)
- Plugin authoring/development tools

### Open Questions (resolved)

1. ~~Does `claude plugin search <query>` exist?~~ No, but
   `claude plugin list --available --json` returns the full catalog with
   descriptions and install counts; the Discover tab filters it client-side.
2. ~~Auto-reload agents after install?~~ No — see Post-Install Agent Refresh.
   Users restart/`/resume` agents themselves; the panel says so.
3. Plugin `userConfig` — still open. The CLI supports
   `claude plugin install --config key=value`; the panel doesn't expose it
   yet. Plugins that require config at install time will fail with the CLI's
   error message shown in the panel, and can be installed from the embedded
   terminal as a fallback.
