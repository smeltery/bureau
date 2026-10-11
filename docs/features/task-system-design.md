# Task System Design (replacing todos)

## Overview

Replace the current human-only todo system with a task system that both agents and humans can use. Rip out the existing todo modal/panel entirely.

## Data Model

- `id`: hash-based short ID (4-char hex, e.g. `a1b2`) to avoid collisions from concurrent creation
- `title`: required
- `description`: optional
- `priority`: optional (P0-P3)
- `status`: open | in_progress | backlog | done | obsolete
- `assignee`: optional, free-text string
- `roomId`: optional stable room id; omitted means office-wide
- `createdBy`: who created it (agent name or human username)
- `createdAt`: timestamp

## Storage

Server holds canonical state in memory, persists to `~/.bureau/tasks.json` on every mutation. Loads on startup. Same pattern as current todos.

## Agent Interface (HTTP API on existing server port 4000)

Agents use `curl` directly — no CLI wrapper, no MCP server, no env variables.

```
GET    /tasks           — list (excludes done/obsolete/backlog by default), ?status=open|done|backlog|all, ?assignee=X, ?title=<query>
GET    /tasks/:id       — full task detail with description
POST   /tasks           — create task
PATCH  /tasks/:id       — update fields, including roomId (convention: agents only use when human directs)
POST   /tasks/:id/claim — set assignee + status=in_progress (409 if someone else holds it)
POST   /tasks/:id/done  — set status=done
```

### Concurrency

Every task returned over HTTP carries a `version`: a hash of its content, computed on read rather than stored. A `PATCH` that includes `version` only applies if it still matches. A stale one returns `409` with the current task, so two agents editing the same task can't silently overwrite each other. A `PATCH` without `version` still applies unconditionally, so older scripts keep working. The browser edits over the WebSocket against live state and does not send versions.

A claim takes an unheld task, or one the named assignee already holds. Claiming a task held by someone else (or claiming without a name while it's held) returns `409 task held`. Taking a task from its holder is an explicit `PATCH` of `assignee`, which can carry the version.

DELETE is available to authenticated callers and the UI uses the WebSocket delete command.

**Why:** System prompt tells agents the API exists. Agents use curl via Bash tool. No special tooling needed.

## Permissions

- Agents: create, claim, done, read. PATCH and DELETE are available but convention (via system prompt) says only when directed by human.
- Humans (UI): full access including delete.
- Enforcement: PATCH and DELETE are convention-based for agents; browser sessions use authenticated APIs and WebSocket commands.

## UI

- Full table page with filters and sorting by column (not a modal)
- New "view mode" in the SPA (like how focusedAgentId toggles office→log view). No router.
- Replace the todo button with a "Tasks" button — no notification badge (too noisy), click enters task view, Escape returns to office
- Post-it notes in office view: keep them, clicking opens task view. Visual appearance still changes based on number of open tasks
- Detail panel for editing a task, including room assignment (not inline editing)
- Real-time updates via WebSocket (same pattern as current office view)
- `createdBy` field distinguishes human vs agent-created tasks visually

## Default List Behavior

`GET /tasks` excludes done, obsolete and backlog tasks by default. Use `?status=all`, `?status=done`, or `?status=backlog` for other views.

## Files to modify

- **Remove**: TodoModal.tsx, TodoPanel.tsx
- **Modify**: App.tsx, OfficeView.tsx, Floor.tsx, AgentListView.tsx, MobileHeader.tsx, store.tsx, types.ts, office-state.ts, server/index.ts, persistence.ts, demo-server.ts
- **Create**: new TaskView component, task-related API routes on server

Close abandoned or superseded work with `PATCH {"status":"obsolete","description":"Reason for closing"}`. Done means the requested work was completed. Obsolete tasks remain readable and can be reopened; default active lists exclude them.

The board supports multiple status and priority checkboxes, including no priority. Counts apply the room, search and assignee filters plus the opposite checkbox group. Clearing a group shows no tasks.

## Durable history and recovery

Task detail includes History, with the actor, timestamp and changed fields for
each recorded edit. The HTTP equivalent is `GET /api/tasks/:id/history`, paged
with the returned `nextCursor`. History requires access to the current task and
filters out events involving rooms the reader cannot access.

Office owners can list `GET /api/tasks/deleted` and restore a deleted task with
`POST /api/tasks/:id/restore`; Tasks also has an owner-only Deleted tasks list.
Owner API tokens and owner-managed privileged agents have the same recovery
access. Restoration retains the task's ID and content, and refuses a room that
no longer exists. Completed and obsolete tasks do not need restoration: they
remain ordinary board records.

Each changed task is persisted in `task-records/:id.json` with its history. A
single atomic rename commits both, before broadcasting the change. Writes that
fail leave the live board unchanged; stale writes are rejected. Deleted records
retain their last content and cannot have their IDs reused. WebSocket writes
check both the current and requested room and derive the actor from the session.

Legacy `tasks.json` is read alongside newer records and stays untouched. The
first subsequent edit records the previous task as its baseline; earlier edit
history cannot be reconstructed. Backups include the new records. Rolling back
to a version that only reads `tasks.json` shows the pre-upgrade board, so retain
a current backup before rollback. History queries read one task file; deleted
lists scan record files. Disk usage grows with retained history.
