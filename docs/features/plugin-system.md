# Bureau Plugin System

> Status: implemented (v0). Hybrid `enabledPlugins` schema (string for bundled, `{id, path}` for external).

A first-party, in-process plugin system for bureau. TypeScript modules register hooks against the agent turn lifecycle. Plugins extend bureau without forking — the canonical use case is wiring a memory layer (e.g. mem0) into every agent's turn loop.

## Motivation

Several plausible integrations (memory layers, observability, redaction, audit) need to sit in the agent turn loop. Hardcoding each into bureau core has obvious cost (every integration touches the central send paths) and obvious lock-in (operators can't add their own). A first-party plugin contract turns the turn loop into an extension point.

The triggering use case is memory injection: `beforeTurn` reads from a vector store and prepends retrieved facts to the prompt; `afterTurn` writes new memories from the turn's output. The plugin system is the long-lived investment.

## Goals (v0)

- One first-party extension point for agent-turn middleware.
- Two hooks: `beforeTurn` and `afterTurn`. Enough for a memory plugin; intentionally minimal.
- In-process TypeScript plugins loaded by the Bun runtime. No IPC, no separate runtimes.
- Office-wide enable/disable via `office-config.json`.
- Trust model: full-trust local code. No sandboxing claims.

## Non-goals (v0)

- Out-of-process plugins (any language).
- Additional hooks (`onAgentCreate`, `onAgentMessage`, `onToolCall`, etc.).
- Plugin-contributed MCP tools or HTTP endpoints.
- Per-agent or per-room enablement.
- Plugin marketplace, install/update commands, manifest validation against a schema.
- UI surfaces (a "Plugins" tab or settings panel).
- A published `@bureau/plugin-types` package. Plugins re-declare types until the API stabilizes.

---

## Hook contract

```ts
export interface PluginTurnContext {
  agentId: string;
  agentName: string;
  roomId: string;
  roomName: string;
  sessionId: string | null; // null on the first turn before system_init
  cwd: string;
  username: string | null; // null when no user is attributed
  visibleText: string; // what the user typed (e.g. "/foo bar")
  originalText: string; // user intent, sender + plugin prefixes stripped
  sdkText: string; // what's about to be sent, sender prefix applied, pre-plugin
}

export interface PluginBeforeTurnResult {
  promptPrefix?: string; // prepended to sdkText, wrapped in delimiters by the hook bus
}

export interface PluginAfterTurnInput {
  status: "completed" | "failed" | "interrupted";
  userTextSent: string; // the final string sent (post-prefix)
  assistantText: string; // concatenated from all text entries
  newLogEntries: LogEntry[]; // entries produced during this turn (see shared/types.ts)
}

export interface BureauPlugin {
  id: string; // must match plugin dir name; [a-z0-9_-]+
  beforeTurn?: (ctx: PluginTurnContext) => Promise<PluginBeforeTurnResult | void>;
  afterTurn?: (ctx: PluginTurnContext, input: PluginAfterTurnInput) => Promise<void>;
}
```

`visibleText` and `sdkText` differ when a skill expands or otherwise transforms the user's input. Plugins generally want `originalText` (user intent, no routing noise) for retrieval queries; `visibleText` is provided for display or auditing purposes; `sdkText` for plugins that need exactly what bureau's routing layer produced.

All `beforeTurn` invocations within a single turn see the **same** pre-prefix `sdkText`. Plugins do not see each other's prefixes during `beforeTurn` (they run in parallel against the same context). This keeps plugins independent.

**Why `promptPrefix`, not system prompt mutation.** `buildSystemPrompt()` only runs at `createSession()` / resume; there is no per-turn system prompt to mutate. Plugins prepend context to the outgoing text with per-plugin delimiters emitted by the hook bus so prompt inspection and debugging stay possible:

```
--- begin plugin: mem0 ---
Nil prefers commas over em dashes
...
--- end plugin: mem0 ---

--- begin plugin: audit ---
(audit's prefix here)
--- end plugin: audit ---

User message:
<original sdkText>
```

## Turn lifecycle integration

Bureau's four send paths (`sendMessage`, `flushQueue`, `executeSkill`, `editMessage`) all route through a central `runAgentTurn` helper in `server/plugins/run-agent-turn.ts`. The helper owns the exact string sent to the backend, so plugins observe what the model actually saw (e.g. expanded skill prompts, not the raw `/skill` invocation).

`runAgentTurn` step-by-step:

1. Call `beginTurn(agentId, { humanInput })` synchronously, BEFORE any await. This claims the turn lifecycle so concurrent ingress sees the agent as busy and queues instead of racing. `beginTurn` is idempotent on `state === "thinking"`.
2. Snapshot `managed.turnCancelToken`. Any control-plane action that cancels an in-flight turn (`abort`, `kill`, `replaceSession`) bumps this counter. We re-check after each await during plugin retrieval and throw `SessionSwappedError` if it changed.
3. Await `managed.afterTurnPromise` from the previous turn (the gate that guarantees `afterTurn` writes from the prior turn landed before this turn's `beforeTurn` retrieval).
4. Build `PluginTurnContext`.
5. Run `beforeTurn` for every enabled plugin in parallel. Per-plugin 5s race; on throw or timeout, the plugin contributes no prefix and the failure logs to `~/.bureau/logs/plugins.jsonl`.
6. Assemble per-plugin prefix blocks in alphabetical id order, delimiter-wrapped, prepended to `sdkText` under a `User message:` separator.
7. `createTurnDeferred` + `session.send(finalText)` + optional `onSendAccepted` callback + snapshot logCache index + `await turn`.
8. Fire `afterTurn` for every plugin (parallel, per-plugin 10s race). Store the aggregate as `managed.afterTurnPromise`. The promise self-clears on settle so a timed-out plugin can't poison future turns.

`afterTurn` runs on all three statuses (`completed` / `failed` / `interrupted`) — plugins choose what to do with each. A turn cancelled DURING plugin retrieval (Stop / session swap before `session.send`) skips `afterTurn` entirely; nothing reached the model, so there's no turn outcome to observe.

## Hook timeouts and cancellation

`Promise.race` against a timeout lets bureau continue; it does NOT cancel in-process work the plugin is still doing. Plugins are expected to be cooperative. For network calls, plugins should accept aborts themselves (pass their own `AbortSignal` to fetch). v0 documents this; no runtime enforcement.

Defaults:

- `beforeTurn` timeout: 5s. On timeout: log, no prefix from that plugin, turn proceeds.
- `afterTurn` timeout: 10s. On timeout: log, the `afterTurnPromise` resolves so the next turn isn't blocked indefinitely.

## Discovery and loading

No directory scanning. `office-config.json`'s `enabledPlugins` array is the authoritative trust boundary: any directory whose code will be imported into the bureau process must be listed there explicitly. Two entry shapes:

1. **Bare string id** — `"safety-hooks"`. A bundled, first-party plugin. Resolved under `<bureauRoot>/plugins/<id>/index.ts`. No path needed; the location is part of the bureau distribution.
2. **`{id, path}` object** — `{ "id": "dossier", "path": "/home/nil/bureau-dossier" }`. An external plugin at an operator-controlled location. `path` must be absolute (`/...`) or tilde-prefixed (`~/...`); relative paths are rejected because they'd resolve against the server cwd. `basename(path)` does NOT have to match `id` — a plugin repo's directory name and its exported id are independent.

For each entry:

- Validate the entry shape (handled in `loadEnabledPlugins`, before the loader sees the list).
- Resolve `<dir>/index.ts` (`<bureauRoot>/plugins/<id>/` for strings, `expandPath(path)` for objects).
- Resolve to realpath. Log realpath on load.
- Dynamic-import `<dir>/index.ts` via `file://` URL. Validate the module exports `id` equal to the configured id plus at least one of `beforeTurn` / `afterTurn`.
- Duplicate ids in `enabledPlugins` are caught in `loadEnabledPlugins` (first occurrence wins, error logged).

Plugins load at boot, after persistence init, before agent restore.

## Enable configuration

Office-wide `enabledPlugins: Array<string | { id: string; path: string }>` in `~/.bureau/office-config.json`. No UI in v0 — operators edit the file. Restart picks up changes.

Example:

```json
{
  "prompt": null,
  "envFile": null,
  "enabledPlugins": [{ "id": "dossier", "path": "/home/nil/bureau-dossier" }]
}
```

## Failure logging

Plugin failures (load errors, hook throws, timeouts) write to `~/.bureau/logs/plugins.jsonl` with structured fields: `pluginId`, `hook`, `durationMs`, `error`. No chat-log entries on normal failures — a noisy memory plugin would degrade core chat. Failures also echo to stderr so they surface in `journalctl --user -u bureau`.

## Trust model

Plugins run with full process privileges: they can read env, read/write filesystem, mutate global state, call out to the network. This is acceptable because plugins are operator-authored or operator-installed local code. The explicit-path requirement for external plugins (`{id, path}` entries) is the cheapest auditable trust signal we can give operators: "here's exactly what code I'm pulling in."

## Plugin placement convention

Two trust paths, two enable shapes:

| Location                     | Purpose                                          | Config entry                          | Tracked in git?                     |
| ---------------------------- | ------------------------------------------------ | ------------------------------------- | ----------------------------------- |
| `<bureauRoot>/plugins/<id>/` | Bundled first-party plugins, shipped with bureau | `"<id>"` (bare string)                | Yes (in bureau repo)                |
| Anywhere on disk             | External plugins, operator-controlled            | `{ "id": "...", "path": "/abs/..." }` | No (operator manages independently) |

For v0, no plugins are bundled in `<bureauRoot>/plugins/`. The directory is reserved for future first-party plugins.

## Reference plugin

[**bureau-dossier**](https://github.com/dotbrains/bureau-dossier) — gives agents long-term memory across sessions, backed by [mem0](https://mem0.ai). Demonstrates the contract end-to-end: `beforeTurn` retrieves relevant memories and prepends them as a prompt prefix; `afterTurn` ships the completed exchange to mem0 cloud for extraction and storage. Lives in a separate repo (per the trust path above) so the `mem0ai` dependency doesn't bleed into bureau's `bun.lock`.

## Acknowledged v0 tradeoffs

- **Latency on chained turns.** The `afterTurnPromise` gate means a queued message waits for the previous turn's `afterTurn` (plus timeout) before processing. Acceptable for v0. If it bites in practice, add an opt-out per plugin or per hook.
- **Plugin ordering is implicit.** Alphabetical by id, results concatenated. Plugins must not depend on each other. Documented; not enforced.
- **No cancellation of plugin work after timeout.** Documented constraint.
- **One throwing plugin doesn't fail the turn**, but it also gets no remediation other than the log entry. No retry, no auto-disable on N failures. Operator monitors logs.
- **Re-declared types in plugins.** Until the API stabilizes, plugins copy the type definitions. Migration to a published types package is a follow-up.

## Future work (not v0)

- More hooks: `onAgentCreate`, `onAgentMessage`, `onToolCall`, `onSessionResume`.
- Per-agent and per-room enable.
- Out-of-process runtime (JSON-RPC over stdio) when language flexibility justifies it.
- MCP server registration from plugin manifests, so plugins can also expose agent-callable tools.
- UI surface (Plugins tab) for enable/disable, status, last-error display.
- Migration of existing in-core features that have hook shape: safety hooks are the obvious first candidate.
- Published `@bureau/plugin-types` package once the contract stops changing.

## Implementation footprint

Net new code:

| Area                             | Files                                                              | Lines             |
| -------------------------------- | ------------------------------------------------------------------ | ----------------- |
| Loader                           | `server/plugins/registry.ts`                                       | ~260              |
| Hook bus + `runAgentTurn` helper | `server/plugins/run-agent-turn.ts`                                 | ~370              |
| Integration                      | `server/agents/conversation/{send,edit,slash-commands,control}.ts` | ~150 (refactored) |
| State fields                     | `server/agents/state.ts`, `server/agents/lifecycle.ts`             | ~30               |
| Types                            | `shared/plugin-types.ts`                                           | ~100              |
| Config loader                    | `server/persistence/config/office-config.ts`                       | ~90               |
| Boot wiring                      | `server/index.ts`                                                  | ~30               |
