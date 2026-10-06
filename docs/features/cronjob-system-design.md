# Cronjob System Design

## Overview

A new "page" (UI view) that lets humans save on-demand or recurring SDK sessions in the office. Each cronjob has a schedule, a name, a prompt, and the same configurability as a bureau agent (model, working directory, permission mode). On schedule, the cronjob spawns a fresh subagent session that runs the prompt; the resulting transcript is preserved as a "run" and is browsable from the UI.

Cronjobs are **not** bureau agents. They have no desk, no room, no persistent identity — only configuration and a history of runs. They are a separate top-level concept stored under `~/.bureau/cronjobs/`.

Example use case: a daily 09:00 cronjob with prompt "look at what every agent accomplished yesterday and summarize" produces a browsable history of daily summaries.

## Architecture

- Each scheduled fire creates a fresh SDK session via `new RawClaudeSession(...)` (a wrapper over the SDK's streaming-input `query()`, the same primitive used by `server/agents/session/runtime.ts`). No `ManagedAgent` wrapper, no PTY, no desk.
- Each run is one session lineage: a root session plus any forks the user creates. This mirrors the agent log structure exactly.
- A single server-side scheduler tick runs every 60s, checks every enabled cronjob's `nextFireAt`, and fires any whose time has passed. Same pattern as `update-checker.ts`.
- Live SDK message stream is broadcast over the existing log-broadcast WebSocket channel, so any UI viewing a currently-running run gets a live tail.

## Data Model

### Cronjob

```ts
interface Cronjob {
  id: string;                  // 8-char hex (matches Task ID format)
  name: string;                // free text, not unique
  schedule: Schedule;          // tagged union below
  prompt: string;              // the user message sent at each fire
  cwd: string;                 // working directory; default "~"
  modelFamily: ModelFamily;    // "opus" | "sonnet" | "haiku"; default "opus"
  permissionMode: "bypassPermissions" | "auto";  // default "bypassPermissions"
  enabled: boolean;            // default true
  createdBy: string;           // username
  device: string | null;       // boss name (multi-boss attribution; null in v1)
  createdAt: number;           // unix ms
  lastFireAt: number | null;   // unix ms of most recent successful start
  nextFireAt: number | null;          // unix ms of next scheduled fire; null for on demand
}

type Schedule =
  | { type: "manual" }
  | { type: "daily"; hour: number; minute: number }
  | { type: "weekly"; weekday: 0|1|2|3|4|5|6; hour: number; minute: number }  // 0 = Sunday
  | { type: "interval"; minutes: number };  // floor enforced server-side (min 5)
```

All times are server-local. Timezone handling is out of scope for v1.

### Run

```ts
interface CronjobRun {
  id: string;                  // 8-char hex
  cronjobId: string;
  cronjobName: string;         // denormalized so deleted-cronjob runs still display
  trigger: "scheduled" | "manual";
  status: "running" | "completed" | "failed" | "timed_out" | "skipped";
  startedAt: number;           // unix ms
  endedAt: number | null;      // unix ms, null while running
  errorReason: string | null;  // populated for failed/timed_out/skipped
  promptSnapshot: string;      // prompt at fire time (config-edits-while-running don't change it)
  modelFamilySnapshot: ModelFamily;
  cwdSnapshot: string;
  permissionModeSnapshot: "bypassPermissions" | "auto";
  rootSessionId: string;       // first session id created at fire time
  previewText: string;         // last assistant text block, truncated ~120 chars
}
```

`status: "skipped"` is recorded for the **overlap** case (a scheduled fire happened while a previous scheduled run was still executing). Missed fires due to server downtime do not produce skipped rows.

### Cronjobs prompt

Stored at `~/.bureau/cronjobs/cronjobs-prompt.md` as raw text (empty file = null prompt). Owned by the cronjob manager; the agent manager does not touch it. Two managers writing the same JSON file from independent in-memory copies would silently clobber each other, which is why this lives in its own file rather than as a field on `office-config.json`.

## Storage Layout

```
~/.bureau/
  office-config.json                   (existing; unchanged)
  cronjobs/
    cronjobs.json                      (configs: Cronjob[])
    cronjobs-prompt.md                 (raw text; system prompt appended to every cronjob)
    cronjob-history.json               (deleted cronjob name preservation: { id -> { lastName } })
    <jobId>/
      runs.json                        (run index: CronjobRun[])
      <runId>/
        sessions.json                  (fork lineage + per-session usage; same shape as agents')
        <sessionId>.jsonl              (one per session in fork tree)
```

Mirrors `~/.bureau/logs/<agentId>/` exactly with one extra layer of nesting (jobId/runId).

## Scheduler Engine

- `setInterval(tick, 60_000)` started in `server/index.ts` alongside the existing update checker.
- Each tick:
  1. Load `cronjobs.json`.
  2. For each enabled cronjob where `now >= nextFireAt`:
     - Check overlap: is there a `runs.json` entry with `trigger == "scheduled" && status == "running"` for this jobId? If yes, write a new run with `status: "skipped"`, leave `nextFireAt` recomputed for the next future instant, and continue.
     - Otherwise, fire (see Run Lifecycle).
- `nextFireAt` is computed from the schedule at config-save time and after each fire.
- **Missed fires (server was down):** on startup, recompute `nextFireAt` for every cronjob from current time forward — the next future scheduled instant. Past instants are skipped silently.
- **Editing a cronjob's schedule** recomputes `nextFireAt` immediately, anchored to `lastFireAt ?? createdAt` so the edit cannot surprise-fire.
- **`interval` schedules** anchor to the cronjob's `lastFireAt ?? createdAt` so the cadence is predictable. The next fire is computed as `floor(elapsed / period) + 1` periods from the anchor — never `ceil`, which would land exactly on `now` and cause an immediate fire on a period boundary.

## Run Lifecycle

- **Fire:** create a new run row with `status: "running"`, generate `rootSessionId`, build the system prompt (see below), open SDK session, send `promptSnapshot` as the first user message. Stream messages append to the run's JSONL and broadcast over WebSocket.
- **Successful completion:** SDK emits its terminal `result` message. Set `status: "completed"`, `endedAt`, and compute `previewText` from the last assistant text block.
- **Hard timeout:** global server constant (30 min for v1). Timer fires, session is killed, `status: "timed_out"`, `errorReason: "exceeded global run timeout"`.
- **Server crash mid-run:** on startup, scan `runs.json` for any row with `status: "running"` and mark `status: "failed"`, `errorReason: "server restarted during run"`. Transcript may be partial; that's fine.
- **On demand:** choose On demand in the schedule form, or send `schedule: { type: "manual" }` through the API. These jobs have `nextFireAt: null` and never fire on a timer, including after restart. Use Run now to start a fresh run. Switching back to a recurring schedule computes its next future fire.
- **`enabled: false`:** cronjob still exists in the table; scheduler skips it. Existing runs remain accessible.
- **Manual "Run now":** identical execution path with `trigger: "manual"`. Does not affect `nextFireAt`. Independent of overlap rule.
- **Edit while running:** allowed. The in-flight run uses its `*Snapshot` fields; the edit applies to the next scheduled fire.
- **`finalizeRun` is idempotent.** Multiple paths can race to finalize (consumer success branch when stream ends, send-fail catch path, hard-timeout handler). The first one wins; later calls no-op. The function calls `session.close()` to release the underlying Claude subprocess and flushes any buffered pre-init log entries to the placeholder rootSessionId so reload finds them.

## System Prompt Layering

Built when a session is created (root or fork). Layers, in order:

1. **Cronjob baseline boilerplate** — "You are a scheduled cronjob named `<name>` running on schedule `<schedule>`. You don't have a desk or persistent identity. Each scheduled run starts fresh."
2. **Office prompt** — same field already shared by all agents.
3. **Cronjobs-wide prompt** — `~/.bureau/cronjobs/cronjobs-prompt.md`. Edited from a "Cronjobs settings" button in the Cronjobs page header. Optional.
4. **Discovery hints** — task-board curl docs and `~/.bureau/agents-summary.json` reference, plus a pointer to past run transcripts: "Past runs of this cronjob are at `~/.bureau/cronjobs/<jobId>/<runId>/`."

The cronjob's own `prompt` field is **not** part of the system prompt — it is sent as the first user message at fire time.

## Permissions / Safety

- Permission mode picker offers only `bypassPermissions` and `auto` (others would block forever in unattended runs).
- Default: `bypassPermissions`.
- The same `safety/` PreToolUse hooks attached to every agent session are also attached to every cronjob session: blocks writes to `~/.bureau/`, destructive git, `rm -rf`, and reads of secrets.
- Cwd validation reuses `validateCwd` from `server/agents/session/paths.ts`.

## HTTP / WebSocket API

WebSocket commands (added to `ClientCommand` union in `shared/types.ts`):

```
add_cronjob       { name, schedule, prompt, cwd?, modelFamily?, permissionMode?, username, device? }
update_cronjob    { id, changes: Partial<Pick<Cronjob, "name" | "schedule" | "prompt" | "cwd" | "modelFamily" | "permissionMode" | "enabled">> }
delete_cronjob    { id }
run_cronjob_now   { id, username, device? }
update_cronjobs_prompt { value: string | null }
list_cronjob_runs { cronjobId }
list_all_cronjob_runs { }
load_cronjob_run  { cronjobId, runId }   // cronjobId from the client so deleted-cronjob runs still load
```

Run rows are immortal: no `delete_run`, no edit. The user can re-run the cronjob to spawn a fresh run; resume/edit-to-fork is filed as a follow-up.

HTTP endpoints (mirror `/tasks`):

```
GET  /cronjobs                    list configs (Cronjob[])
GET  /cronjobs/:id                single config (Cronjob)
GET  /cronjobs/:id/runs           run list (CronjobRun[])
GET  /cronjobs/:id/runs/:runId    { run, entries }
```

DELETE blocked at HTTP level (WebSocket-only, mirroring tasks).

## UI

Two flat top-level tables, accessed via the `Cronjobs` button in the office HUD bar. The page lands on the **Runs** tab by default, and toggles to **Cronjobs** for config editing.

### Top-level state (in `ui/store.tsx`)

```ts
cronjobs: Cronjob[]
cronjobsPrompt: string | null
cronjobRunsByJob: Map<string, CronjobRun[]>
```

`cronjobsOpen` / `runFilter` are component-local React state.

### Cronjobs tab

Full-width table. Columns: enabled toggle, name, schedule (humanized), last run, next run, runs count, createdBy, actions (Run / Edit).

- "+ New" button opens a modal (`CronjobDialog`) with form fields for cwd / model / permission mode / schedule / prompt.
- Clicking a row body navigates to the Runs tab with a pinned filter chip `Cronjob: <name> ✕`.
- "Edit" opens the edit modal; delete is a confirm-dialog action inside it.

### Runs tab

Full-width table. Columns: status icon (✓ ✗ ⏱ ⊘), trigger icon (clock vs play), cronjob name, started at (relative), preview text, duration.

- Pagination (50 rows / page).
- Pinned filter chip when arriving from a cronjob row click.
- Clicking a run opens a read-only transcript (`CronjobRunView` reuses `LogEntryCard` from `ui/log-view/entries/`). Sorted by entry timestamp so live-then-backfill arrival order doesn't reorder visually.

### Cronjobs settings dialog

Header button on the Cronjobs page → modal with one textarea for `cronjobsPrompt`.

## Usage Command Integration

`renderUsageReport()` in `server/agents/usage.ts` gains a third table: per-cronjob lifetime usage. Each run's usage is computed exactly like an agent's: `sum across (session.usage − session.forkBaseUsage)` over the run's `sessions.json`. Deleted cronjobs render with `_(deleted)_` suffix (mirrors deleted-room handling); `cronjob-history.json` preserves the last name. The grand total at the bottom is renamed to "Office total" and folds in cronjob spend so the office-wide number is honest.

## Out of Scope for v1

- Cron-expression syntax (only the three primitive types above). Can be added later as a fourth `Schedule` variant.
- Timezone configuration (server local only).
- Catch-up / replay of missed fires.
- Run retention policy (all runs kept forever; pagination handles size).
- Run deletion affordance.
- Notifications / alerts on failure.
- Per-cronjob hard-timeout override (single global constant).
- Per-cronjob `customInstructions` field (prompt covers it).
- Resuming / forking a run (today the user can re-trigger with "Run now" to start a fresh run).
- Sharing / deep-linking individual runs by URL.
- Branched fork visualization.

## Files

**Created**
- `ui/components/CronjobsView.tsx` — top-level page with tab toggle + Cronjobs table + Runs table.
- `ui/components/CronjobRunView.tsx` — read-only run transcript viewer.
- `ui/components/modals/CronjobDialog.tsx` — create/edit modal.
- `ui/components/modals/CronjobsPromptDialog.tsx` — single-textarea modal for `cronjobsPrompt`.
- `server/cronjobs/index.ts` — scheduler tick, fire path, run lifecycle, usage rollup helpers.
- `server/persistence/cronjobs.ts` — load/save for cronjobs.json, runs.json, sessions.json under cronjobs/, cronjob-history.json.
- `server/http/cronjobs.ts` — read-only HTTP endpoints under `/cronjobs`.
- `docs/features/cronjob-system-design.md` — this file.

**Modified**
- `shared/types.ts` — Cronjob, CronjobRun, Schedule types; new ClientCommand variants; ServerMessage events for cronjob and run state changes.
- `server/persistence/paths.ts` — `CRONJOBS_DIR`, `CRONJOBS_FILE`, `CRONJOB_HISTORY_FILE`, `CRONJOBS_PROMPT_FILE`.
- `server/persistence/index.ts` — re-exports cronjobs persistence module.
- `server/index.ts` — start scheduler tick on boot; HTTP routes; WebSocket command handlers; startup reconciliation of `running` rows.
- `server/ws/commands.ts` — WS command handlers for `add_cronjob`, `update_cronjob`, `delete_cronjob`, `run_cronjob_now`, `update_cronjobs_prompt`, `list_cronjob_runs`, `list_all_cronjob_runs`, `load_cronjob_run`.
- `server/agents/usage.ts` — per-cronjob table + Office total.
- `ui/store.tsx` — adds `cronjobs`, `cronjobsPrompt`, `cronjobRunsByJob` to AppState; reducer cases; per-stream Set dedupe in the log-entry reducer.
- `ui/App.tsx` — `cronjobsOpen` state, conditional render, history-stack integration.
- `ui/office/OfficeView.tsx` — Cronjobs nav button.

## Implementation notes

- Cronjobs do not expose a `--effort` thinking-effort field (no `EffortLevel` import, no `--effort` flag in `executableArgs`).
- The cronjob picker restricts `permissionMode` to `bypassPermissions | auto`, narrower than the full agent union.
- Cronjob persistence lives under `server/persistence/`, alongside `logs/` and `config/`, rather than as a sibling top-level file.

## Room access and migration

Schedules have a `roomId`. The dialog chooses from accessible rooms, and the
Schedules view can filter definitions and historical runs by room. Room members
can read schedules, prompts, transcripts and usage in their rooms. Only the
creator or an office owner can edit, delete or trigger the schedule. The global
schedule prompt remains owner-managed. REST, WebSocket snapshots and live events,
agent prompt discovery and usage reports enforce the same visibility.

On upgrade, a legacy schedule without a room is assigned its creator's default
room, falling back to their first accessible room. If no room can be resolved,
it remains creator/owner-only until an owner assigns one. Startup persists the
migration and records room and creator snapshots on legacy runs. Deleted jobs
without recoverable attribution remain office-owner-only. Back up the state
folder before upgrading if you need to review historical room placement.

Each new run freezes its room and creator. Moving a schedule changes future runs;
it does not transfer historical transcripts or usage to the destination room.
Deleting the definition retains authorized access to its history. Removing a
member's room access takes effect on existing browser connections as well.

[Signed inbound webhooks](inbound-webhooks.md) can start runs without changing
the schedule's timer. These runs carry a `webhook` trigger and delivery metadata.
