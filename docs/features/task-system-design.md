# Task System Design (replacing todos)

## Overview

Replace the current human-only todo system with a task system that both agents and humans can use. Rip out the existing todo modal/panel entirely.

## Data Model

- `id`: hash-based short ID (4-char hex, e.g. `a1b2`) to avoid collisions from concurrent creation
- `title`: required
- `description`: optional
- `priority`: optional (P0-P3)
- `status`: open | in_progress | backlog | done
- `assignee`: optional, free-text string
- `roomId`: optional stable room id; omitted means office-wide
- `createdBy`: who created it (agent name or human username)
- `createdAt`: timestamp

## Storage

Server holds canonical state in memory, persists to `~/.bureau/tasks.json` on every mutation. Loads on startup. Same pattern as current todos.

## Agent Interface (HTTP API on existing server port 4000)

Agents use `curl` directly — no CLI wrapper, no MCP server, no env variables.

```
GET    /tasks           — list (excludes done/backlog by default), ?status=open|done|backlog|all, ?assignee=X, ?title=<query>
GET    /tasks/:id       — full task detail with description
POST   /tasks           — create task
PATCH  /tasks/:id       — update fields, including roomId (convention: agents only use when human directs)
POST   /tasks/:id/claim — set assignee + status=in_progress
POST   /tasks/:id/done  — set status=done
```

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

`GET /tasks` excludes done and backlog tasks by default. Use `?status=all`, `?status=done`, or `?status=backlog` for other views.

## Files to modify

- **Remove**: TodoModal.tsx, TodoPanel.tsx
- **Modify**: App.tsx, OfficeView.tsx, Floor.tsx, AgentListView.tsx, MobileHeader.tsx, store.tsx, types.ts, office-state.ts, server/index.ts, persistence.ts, demo-server.ts
- **Create**: new TaskView component, task-related API routes on server
