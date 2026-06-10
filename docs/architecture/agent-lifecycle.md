# Agent Lifecycle

How Bureau manages Claude Code SDK sessions — from spawn to stream processing to session replacement.

## Core Abstraction: ManagedAgent

Each agent is tracked as a `ManagedAgent` in `server/agents/state.ts` (the shared state hub — the `agents: Map<string, ManagedAgent>` singleton and its emit/log helpers all live here):

```typescript
interface ManagedAgent {
  info: AgentInfo;              // Public metadata (name, desk, cwd, etc.)
  session: SDKSession | null;   // Active SDK session
  sessionId: string | null;     // Current session ID
  consumerPromise: Promise<void> | null;  // Persistent stream consumer
  pendingTurn: { resolve, reject } | null; // Per-turn deferred
  aborting: boolean;            // Session is being aborted
  slashCommands: CommandConfig[]; // Autocomplete commands
  skills: SkillInfo[];          // Discovered skills
  sdkReportedCommands: string[]; // Commands from SDK system:init
  // Timing
  thinkingStartedAt: number;
  toolCallTimestamps: Map<string, number>;
  // Topic generation
  topicGenerating: boolean;
  topicMessageCount: number;
  // Resume two-step
  pendingResume: boolean;
  pendingResumeSessions: SessionInfo[];
  // Model switching
  pendingModelPick: boolean;
  // Permission prompts
  pendingPermission: { ... } | null;
  // Terminal PTY
  ptySidecar: Subprocess | null;
  ptyBuffer: string;
  // Usage tracking
  lastWrittenEntryId: string | null;
}
```

All agents live in a single `Map<string, ManagedAgent>`.

## Session Creation

Sessions are created via the SDK's `query()` API in streaming-input mode, wrapped in bureau's `RawClaudeSession` class (`server/backends/claude.ts`). Streaming-input mode is used over a one-shot string prompt because it keeps a long-lived conversation open and returns a `Query` handle exposing `interrupt()` — essential for abort functionality. `RawClaudeSession` restores the familiar `send()` / `stream()` / `close()` shape on top of `query()`'s push-based input model.

### Session Options

```typescript
const opts = {
  model: managed.info.model,
  cwd: managed.info.cwd,
  permissionMode: managed.info.permissionMode,
  pathToClaudeCodeExecutable: CLAUDE_NATIVE_BIN,
  executableArgs: ["--append-system-prompt", buildSystemPrompt(...)],
  hooks: createSafetyHooks(),
};
```

These `options` are passed to `query({ prompt, options })`, where `prompt` is the push-able input queue. The system prompt is built from four hierarchical layers (baseline → office → room → agent-specific) and injected via `--append-system-prompt`. Since `Options` doesn't expose `appendSystemPrompt` directly, it's smuggled through `executableArgs`.

The native binary path is resolved explicitly to avoid the SDK's musl/glibc auto-resolver bug on Linux.

### Resume vs Create

- **New session**: `new RawClaudeSession(options)` → `query({ prompt, options })`
- **Resume session**: same, with `resume: sessionId` added to `options` (i.e. `query({ prompt, options: { resume: sessionId } })`)

On startup, agents are restored from `agents.json` and their last session is resumed.

## The Persistent Consumer Loop

The most critical piece of the agent architecture. Each session has a persistent async loop that iterates `session.stream()`:

```typescript
async function runConsumer(agentId, managed, boundSession) {
  while (agents.has(agentId) && managed.session === boundSession) {
    for await (const msg of boundSession.stream()) {
      processMessage(agentId, msg);
    }
    // Inner generator ended — resolve pending turn
    managed.pendingTurn?.resolve();
  }
}
```

### Why a persistent loop?

The `Query` generator (exposed as `stream()`) yields events for one turn, then pauses awaiting the next pushed input. Between turns, background processes (like long-running bash) can emit `task_notification` events. Without a persistent loop, these would sit buffered until the next user turn — causing delayed log entries. See [Held-Back Messages Investigation](../investigations/held-back-messages-investigation.md).

### Turn Coordination

Each user message creates a per-turn deferred:

```typescript
function createTurnDeferred(managed): Promise<void> {
  // Reject any stale deferred
  managed.pendingTurn?.reject(new Error("Superseded by a new turn."));
  const promise = new Promise<void>((res, rej) => { ... });
  managed.pendingTurn = { resolve, reject };
  return promise;
}
```

The consumer resolves this deferred when `stream()` ends (at the `result` event). `sendMessage()` awaits this so the caller knows when the turn is complete.

## Session Swapping

When a session needs to be replaced (abort, resume, model switch), `replaceSession()` handles the swap:

1. Reject any pending turn with `SessionSwappedError`.
2. Close the old session (`session.close()`).
3. Await the old consumer to drain.
4. Install the new session and spawn a new consumer.

The consumer loop detects the swap via `managed.session === boundSession` and exits cleanly.

## Message Processing

`processMessage()` converts SDK messages into log entries and state updates:

| SDK Message Type | Log Entry Kind | State Change |
|-----------------|----------------|--------------|
| `system` (init) | — | Sets `sessionId`, captures slash commands |
| `system` (local_command_output) | `system` | — |
| `assistant` (text) | `text` | — |
| `assistant` (tool_use) | `tool_call` | → `tool_executing` |
| `assistant` (thinking) | `thinking` | → `thinking` |
| `user` (tool_result) | `tool_result` | — |
| `result` (success) | — | → `waiting_for_response`, usage accounting |
| `result` (error) | `error` | → `error` |

### State Machine

```
idle ──send_message──> thinking ──tool_use──> tool_executing
  ^                      │                        │
  │                      └──text_only─────────────┘
  │                                               │
  └──result──────────────────────────────────── waiting_for_response
                                                  │
                                        ──error──> error
```

## Topic Generation

On the first user message (and when regenerated), a background one-shot `query()` (via the `runClaudeOneShot` helper in `server/backends/claude.ts`) generates a short topic:

- Uses `claude-sonnet-4-20250514` (cheaper model).
- Context: first user message + last 5 text entries.
- Output: max 8 words, no trailing punctuation.
- Stored in `sessions.json` for resume list display.
- `topicStale` flag tracks when new messages arrive after topic generation.

## Agent Commands

### Spawn

1. Validate `cwd` exists and is a directory.
2. Save to recent CWDs.
3. Create `ManagedAgent` with generated outfit, discovered skills.
4. Create SDK session, install consumer.
5. Emit `agent_added` to all browsers.

### Kill

1. Close session (unblocks consumer).
2. Await consumer drain.
3. Remove from agents map.
4. Emit `agent_removed`.

### Abort

1. Set `aborting = true`.
2. Close session (unblocks consumer).
3. Await consumer drain.
4. Recreate session with same `sessionId`.
5. Install new consumer.

### Resume

1. List available sessions from disk.
2. User picks session ID.
3. Close current session.
4. Resume selected session via a new `RawClaudeSession` with `resume: sessionId` in its options.
5. Install consumer, emit log history.

### Edit Agent

- Name/cwd/outfit/instructions: update `AgentInfo`, emit `agent_updated`. Next conversation picks up changes.
- Model/permission mode: recreate session immediately so change takes effect now.

## CWD Change Handling

When an agent's `cwd` changes, Claude CLI session files must be moved. The CLI stores sessions in `~/.claude/projects/{sanitized-cwd}/{sessionId}.jsonl`. Bureau moves both the `.jsonl` files and sibling session directories to the new project path.

## Error Diagnosis

When a process exits with code 1, `diagnoseProcessExit()` provides hints:
- **Missing cwd**: "Directory no longer exists. Click the agent name to pick a valid directory."
- **Missing session file**: "Session not found in project dir. This happens after cwd was moved/renamed."

## Related Docs

- [Server Architecture](server-architecture.md) — HTTP/WebSocket layer
- [Persistence Layer](persistence-layer.md) — Session storage and usage accounting
- [Safety Hooks](safety-hooks.md) — PreToolUse hook injection
- [Command & Skill System](command-skill-system.md) — Slash command handling
