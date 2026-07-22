# Server Architecture

The Bureau server is a single Bun process that handles HTTP, WebSocket, static file serving, and agent lifecycle management. It runs on port 4000 by default.

## Entry Point

`server/index.ts` — the sole entry point. Uses `Bun.serve()` to handle all traffic in one process.

## HTTP Routing

All HTTP routing happens in a single `fetch` handler. Routes are evaluated by pathname prefix:

| Path | Method | Handler | Purpose |
|------|--------|---------|---------|
| `/ws` | GET (upgrade) | WebSocket handler | Browser client connections |
| `/__live_reload` | GET | SSE stream | Dev-mode live reload via Server-Sent Events |
| `/tasks` | GET | Task list | Filtered task board (excludes `done` by default) |
| `/tasks/:id` | GET | Task detail | Single task lookup |
| `/tasks` | POST | Task create | Create task (agent-accessible via curl) |
| `/tasks/:id` | PATCH | Task update | Update task fields |
| `/tasks/:id/claim` | POST | Task claim | Claim task (sets `in_progress`) |
| `/tasks/:id/done` | POST | Task mark done | Mark task complete |
| `/api/upload/:agentId` | POST | File upload | Multipart file upload (max 5 files, 20MB each, 40MB total) |
| `/api/files/:agentId/:filename` | GET | File serve | Serve uploaded files with caching |
| `/api/images/:agentId/:filename` | GET | File serve (legacy) | Legacy path, redirects to files/ logic |
| `/api/version` | GET | System info | Build version, commit, and release tag for signed-in users and local agents |
| `/` + static | GET | Static file server | Serves `ui/dist/` with SPA fallback |

### Task API Design

The task board has a dual-access pattern:
- **WebSocket**: Browser UI creates/updates tasks via `ClientCommand`, server broadcasts `tasks` events to all clients.
- **HTTP REST API**: Agents interact via `curl` from their system prompt. CORS headers allow cross-origin access.

DELETE is explicitly blocked at the HTTP level (`405`) to prevent agents from deleting tasks. The WebSocket path handles deletion via `delete_task` command (human-only).

### File Upload Pipeline

1. Browser uploads via multipart `POST /api/upload/{agentId}`.
2. Server validates: max 5 files, 20MB per file, 40MB total.
3. Each file is saved via `saveFile()` in `persistence.ts` (SHA256-deduped in `~/.bureau/logs/{agentId}/files/`).
4. Returns attachment metadata array to the browser.
5. Upload-to-message path is separate: attachments are referenced when the actual SDK message is sent.

### Live Reload

Enabled via `BUREAU_LIVE_RELOAD=1`. Uses `fs.watch` on `ui/dist/` with 120ms debounce. Browsers connect via SSE at `/__live_reload` and receive `data: reload` events. The UI uses `EventSource` to listen and triggers `window.location.reload()`.

## WebSocket Protocol

### Connection Lifecycle

```
Browser                          Server
  │                                │
  ├── WebSocket connect ──────────>│
  │                                │
  │<── full_state ─────────────────┤  (agents, recentCwds, office, rooms)
  │<── tasks ──────────────────────┤  (current task board)
  │<── update_status ──────────────┤  (if update available)
  │<── log_entry (×N) ─────────────┤  (per-agent cached history)
  │<── slash_commands (×N) ────────┤  (per-agent commands + skills)
  │                                │
  │── ClientCommand ──────────────>│  (user actions)
  │<── ServerMessage ──────────────┤  (state changes)
  │                                │
  ├── disconnect ─────────────────>│  (server removes from broadcast set)
```

### Server → Browser Messages (`ServerMessage`)

All messages flow through a single `broadcast()` function (defined in `server/ws/broadcast.ts`). The event system in `server/agents/state.ts` emits `AgentEvent` objects that are cast to `ServerMessage` and broadcast to all connected browsers. The root-level `server/agent-manager.ts` re-exports the agent API via a thin barrel.

Key message types:
- `full_state` — initial snapshot on connect
- `agent_added` / `agent_removed` / `agent_updated` — agent lifecycle
- `log_entry` — conversation entries (text, tool_call, tool_result, thinking, error, system, user_message)
- `clear_logs` — agent conversation was cleared
- `tasks` — full task board snapshot
- `terminal_output` / `terminal_exit` — PTY sidecar output
- `room_*` / `office_settings_updated` / `rooms_reordered` — room/office changes
- Response types (`settings_save_response`, `cwd_validation`, `agent_save_response`) — sent only to the requesting client

### Browser → Server Commands (`ClientCommand`)

Commands are parsed from JSON in the WebSocket `message` handler and dispatched to `handleCommand()`. Most are synchronous; `send_message` and `edit_message` are deliberately **not awaited** to keep the event loop free while the SDK streams in the background.

Command categories:
- **Agent lifecycle**: `spawn`, `kill`, `abort`, `new_conversation`, `resume`
- **Conversation**: `send_message`, `edit_message`
- **Agent config**: `edit_agent`, `swap_desks`, `set_topic`, `reset_topic`
- **Terminal**: `terminal_open`, `terminal_input`, `terminal_resize`, `terminal_close`
- **Room management**: `create_room`, `close_room`, `rename_room`, `move_agent`, `reorder_rooms`
- **Settings**: `update_office_settings`, `update_room_settings`
- **Validation**: `request_cwd_validation`, `request_settings_validation`
- **Tasks**: `add_task`, `update_task`, `delete_task`
- **Utility**: `ping`, `list_sessions`

### Broadcast Architecture

```
AgentManager events ──> onEvent handler ──> broadcast() ──> all browsers
                                                              │
                                                              ├── Browser A
                                                              ├── Browser B
                                                              └── Phone
```

The `browsers` Set holds all active WebSocket connections. `broadcast()` iterates and sends to each. No per-client filtering — all browsers see all state changes.

## Static File Serving

Serves `ui/dist/` on every request (no in-memory cache). SPA fallback returns `index.html` for any unmatched path. `Cache-Control: no-cache` ensures fresh builds are always served.

The server reads from `ui/dist/` on each request — no restart needed after `bun run build:ui`.

## Startup Sequence

1. Load tasks from `tasks.json`.
2. Start update checker (polls git for new commits).
3. Call `AgentManager.restoreAgents()` — reads `agents.json`, recreates sessions, loads log caches.
4. Log restored agent count.
5. Print `Bureau running at http://localhost:{port}`.

## Key Design Decisions

- **Single process**: No Node, no separate frontend server. Bun handles everything.
- **No database**: File system is the source of truth. JSON files for config, JSONL for logs.
- **Non-blocking messages**: `send_message` is fire-and-forget so other commands (spawns, aborts) aren't blocked.
- **No per-client state**: All browsers receive the same broadcast. Client-side store handles local-only state (input drafts, attention tracking).
- **CORS on task API only**: Agents need cross-origin access; other endpoints are same-origin.

## Related Docs

- [Agent Lifecycle](agent-lifecycle.md) — SDK session management and event processing
- [Persistence Layer](persistence-layer.md) — File system layout and data formats
- [Safety Hooks](safety-hooks.md) — PreToolUse hook system
