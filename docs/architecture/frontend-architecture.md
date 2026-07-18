# Frontend Architecture

The Bureau frontend is a React application rendered as raw SVG, with a Redux-like store pattern and WebSocket-driven state management.

## Build System

- **Bundler**: Bun's native bundler (no Vite, no Webpack).
- **Build command**: `bun run build:ui` — bundles JSX, copies `index.html` and `xterm.css` into `ui/dist/`.
- **Dev mode**: `bun run dev` — watch-build + server watch-restart + live reload via SSE.
- **No restart needed**: Server reads from `ui/dist/` on each request.

## State Management: Redux-Like Store

The frontend uses a `useReducer` store where **server messages are actions**. No action creators — `ServerMessage` types from the WebSocket are dispatched directly into the reducer.

```typescript
// Server message → reducer action
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data) as ServerMessage;
  dispatch(msg); // Direct dispatch, no transformation
};
```

### Store State Shape

The store manages both server-driven and local-only state:

- **Server-driven**: agents, rooms, office settings, tasks, log entries, slash commands
- **Local-only**: user-scoped input drafts (preserved when switching agents and reloading), attention tracking, focused agent, UI visibility states

### Adding New Server Events

Zero boilerplate: define the message type on the server, add a case to the reducer, done. The same `ServerMessage` union flows end-to-end.

## WebSocket Client (`ws.ts`)

Manages the WebSocket connection lifecycle:

- **Connect**: Opens WebSocket to `/ws`.
- **Reconnect**: Automatic reconnection with backoff on disconnect.
- **Message handling**: Parses `ServerMessage` and dispatches to store.
- **Command sending**: Serializes `ClientCommand` and sends over WebSocket.
- **Ping/pong**: Heartbeat to detect stale connections.

## Component Architecture

### Top-Level Structure

```
App
├── OfficeView (isometric SVG scene)
│   ├── RoomContainer
│   │   ├── RoomTab
│   │   └── IsometricScene (SVG)
│   │       ├── Room (per room)
│   │       │   ├── Desk (×8)
│   │       │   │   ├── Agent character
│   │       │   │   ├── Nametag + topic
│   │       │   │   └── State indicators (thinking, tool, error)
│   │       │   ├── Corkboard (task board trigger)
│   │       │   ├── Framed sign (office prompt trigger)
│   │       │   └── Window (dark mode toggle)
│   │       └── Neon sign
│   └── AgentListView (mobile fallback)
├── LogView (conversation panel)
│   ├── LogEntry (per message)
│   ├── InputBox (message input)
│   ├── SlashCommandAutocomplete
│   └── FileAttachmentPreview
├── TaskBoard (corkboard modal)
├── SpawnDialog (new agent form)
├── SessionList (resume picker)
└── SettingsPanel (office/room config)
```

### SVG Scene

The entire isometric office is raw SVG — ~1,600 lines of coordinates, bezier curves, and `<animate>` tags. No libraries, no external assets.

Key SVG features:
- **Neon sign**: Skewed font, light diffusion, flickering animation via `<animate>`. Ligatures between letters for realism.
- **Agent characters**: Composed from outfit parts (hat, hair, shirt, accessories) colored from the `AgentOutfit` config.
- **State animations**: Pulsing indicators for attention, thinking animation for active agents.
- **Dark mode**: CSS class toggled on the SVG container, with color overrides.

### Mobile Support

- **Swipe gestures**: Left/right swipe replaces Tab/Shift+Tab for agent cycling.
- **Agent list view**: Optional flat list for small screens where the isometric scene is too small.
- **PWA**: `manifest.json` + `sw.js` enable "Add to home screen" for a native-like experience.

## Attention Tracking

An agent "needs attention" when:
1. It transitions from a working state (`thinking`, `tool_executing`) to a terminal state (`waiting_for_response`, `error`, `stopped`).
2. The user is currently looking at a different agent.

Visual indicators:
- **Office view**: Pulsing dot on the agent's desk.
- **Hidden tab**: Browser tab title shows notification count.
- **Sound**: Optional audio notification when tab is hidden.

## Log View

Displays conversation entries with rich formatting:

- **Text entries**: Markdown-like rendering.
- **Tool calls**: Expandable blocks showing tool name and input.
- **Tool results**: Collapsible output (truncated to 10k chars).
- **Thinking**: Collapsible extended thinking with duration.
- **Images**: Rendered inline (from agent file reads or uploads).
- **System messages**: Styled differently (session init, clear, errors).

### Slash Command Autocomplete

Triggered by `/` in the input box. Shows commands and skills with descriptions. Commands come from the config registry; skills are discovered per-agent from the SDK's `system:init` message.

## File Attachments

### Upload Flow

1. User selects files in the input box.
2. Files are uploaded via `POST /api/upload/{agentId}` (multipart).
3. Upload progress shown in the input area.
4. "Send" button is blocked while uploads are in progress.
5. On send, text + attachment references are combined into the SDK message.

### Display Flow

- Agent-generated images appear inline when the agent reads an image file (side-effect of the Read tool).
- User-uploaded files show as attachment chips in the conversation.

## Embedded Terminal

Uses xterm.js for a PTY terminal per agent:

1. User clicks terminal icon → `terminal_open` command.
2. Server spawns a Node.js PTY sidecar (`pty-sidecar.cjs`).
3. Buffered output is replayed to the browser.
4. Input/output flows over WebSocket (`terminal_input`, `terminal_output`).
5. Terminal closes on `terminal_close` or sidecar exit.

The PTY sidecar is spawned on-demand (not per-agent by default) to conserve resources.

## Key Design Decisions

- **Server messages as actions**: Eliminates action-creator boilerplate. One type definition, end-to-end.
- **Local-only state in store**: Input drafts, attention tracking — all in the same reducer; drafts are also persisted per user and agent in browser storage.
- **Raw SVG**: No canvas, no DOM libraries. SVG is declarative, themeable, and scales perfectly.
- **No build tooling beyond Bun**: Simple, fast, no config drift.
- **Mobile-first gestures**: Swipe navigation, collapsible panels, agent list fallback.

## Related Docs

- [Server Architecture](server-architecture.md) — WebSocket protocol and message types
- [Shared Types](../../shared/types.ts) — `ServerMessage` and `ClientCommand` definitions
