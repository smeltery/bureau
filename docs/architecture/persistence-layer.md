# Persistence Layer

Bureau uses the file system as its sole source of truth. No database — just JSON and JSONL files in `~/.bureau/`.

## Directory Layout

```
~/.bureau/
├── agents.json              # Agent configs organized by room
├── agents-summary.json      # Lightweight manifest for agent discovery
├── office-config.json       # Office-level settings (prompt + env file)
├── office-prompt.md         # Legacy backup (migrated to office-config.json)
├── tasks.json               # Shared task board
├── agent-history.json       # Last-known name/room for killed agents
├── recent-cwds.json         # Recently used working directories (autocomplete)
└── logs/
    ├── {agentId}/
    │   ├── {sessionId}.jsonl    # Conversation log entries
    │   ├── sessions.json        # Per-session metadata (usage, topics, forks)
    │   └── files/               # Uploaded/attached files (SHA256-deduped)
    └── ...
```

## Agent Configuration (`agents.json`)

Stores agents organized by room. Each room has a stable ID, display name, and per-room settings:

```json
[
  {
    "id": "a1b2c3d4",
    "name": "Room 1",
    "prompt": null,
    "envFile": null,
    "agents": [
      {
        "id": "agent-1774819851476-qmpf",
        "name": "PersonalSiteAgent",
        "desk": 7,
        "cwd": "~/my-project",
        "outfit": { "hat": "cap", "color": "#3b82f6", "hair": "#1a1a1a", "hairStyle": "short", "skin": "#d4a574", "beard": "none", "accessory": "glasses" },
        "permissionMode": "default",
        "modelFamily": "opus",
        "lastSessionId": "session-abc123",
        "topic": "Fixing auth middleware tests",
        "customInstructions": "Always write tests first"
      }
    ]
  }
]
```

### Migration

The loader handles multiple legacy formats:

- Flat array of agents → wrapped in default room
- Array of arrays → each becomes a room with generated ID
- Missing `modelFamily` → migrated from legacy `model` field (e.g., `"claude-opus-4-6"` → `"opus"`)
- Missing room `id`/`prompt`/`envFile` → filled with defaults

## Agent Summary Manifest (`agents-summary.json`)

A lightweight version of agent info injected into every agent's system prompt for peer discovery:

```json
[
  {
    "id": "agent-1774819851476-qmpf",
    "name": "PersonalSiteAgent",
    "desk": 7,
    "room": 2,
    "roomName": "Side Projects",
    "topic": "Write technical blog post",
    "cwd": "~/my-project",
    "modelFamily": "opus",
    "model": "claude-opus-4-7",
    "logDir": "~/.bureau/logs/agent-1774819851476-qmpf"
  }
]
```

Agents read this file to discover other agents and their conversation logs.

## Conversation Logs (JSONL)

Each session gets an append-only JSONL file. One `LogEntry` per line:

```json
{"id":"log-1774819851476-abc1","agentId":"agent-123","timestamp":1774819851476,"kind":"user_message","content":"Fix the login bug"}
{"id":"log-1774819851477-def2","agentId":"agent-123","timestamp":1774819851477,"kind":"thinking","content":"I'll start by...","metadata":{"duration_ms":1200}}
{"id":"log-1774819851478-ghi3","agentId":"agent-123","timestamp":1774819851478,"kind":"tool_call","content":"Read","metadata":{"toolId":"tool_abc","input":{"file_path":"src/auth.ts"}}}
{"id":"log-1774819851479-jkl4","agentId":"agent-123","timestamp":1774819851479,"kind":"tool_result","content":"export function login() {...}","metadata":{"toolUseId":"tool_abc","duration_ms":45}}
{"id":"log-1774819851480-mno5","agentId":"agent-123","timestamp":1774819851480,"kind":"text","content":"I found the issue..."}
```

### Log Entry Kinds

| Kind           | Description                                    |
| -------------- | ---------------------------------------------- |
| `user_message` | User's message to the agent                    |
| `thinking`     | Agent's extended thinking (with `duration_ms`) |
| `tool_call`    | Tool invocation (name + input in metadata)     |
| `tool_result`  | Tool output (truncated to 10k chars)           |
| `text`         | Agent's text response                          |
| `error`        | Error messages                                 |
| `system`       | System messages (session init, clear, etc.)    |

### Fork-Aware Log Loading

When a conversation is forked (edit past message), each session's JSONL only stores its own entries. `loadLogWithAncestors()` walks the `forkedFrom` chain in `sessions.json` and assembles the full history:

1. Build ancestor chain: `[oldest, ..., parent, self]`
2. For each ancestor: load entries before the fork point (`forkMessageId`)
3. For self: load all entries
4. Concatenate oldest-first

This avoids data duplication across JSONL files.

## Session Metadata (`sessions.json`)

Per-agent session metadata with usage accounting:

```json
{
  "session-abc123": {
    "topic": "Fixing auth middleware tests",
    "lastModified": 1774819851476,
    "forkedFrom": "session-xyz789",
    "forkMessageId": "log-1774819851478-ghi3",
    "usage": {
      "inputTokens": 12345,
      "outputTokens": 6789,
      "cacheReadInputTokens": 10000,
      "cacheCreationInputTokens": 5000,
      "costUSD": 0.42
    },
    "priorRunsUsage": {
      "inputTokens": 50000,
      "outputTokens": 25000,
      "cacheReadInputTokens": 40000,
      "cacheCreationInputTokens": 20000,
      "costUSD": 1.80
    },
    "forkBaseUsage": {
      "inputTokens": 8000,
      "outputTokens": 4000,
      "cacheReadInputTokens": 6000,
      "cacheCreationInputTokens": 3000,
      "costUSD": 0.25
    },
    "usageSnapshots": [
      { "entryId": "log-abc", "usage": { "inputTokens": 1000, "outputTokens": 500, ... } }
    ]
  }
}
```

### Usage Accounting

The SDK reports two flavors of accounting on each `result` event:

- **Tokens** (`input_tokens`, `output_tokens`, cache fields) are **per-turn deltas**. Summed across turns.
- **Cost** (`total_cost_usd`) is **cumulative-per-process**. Overwritten each turn. Resets to 0 on session resume.

Two buckets per session:

- `usage`: current run (tokens accumulated, cost overwritten)
- `priorRunsUsage`: completed runs, rolled up on resume

Session lifetime = `usage` + `priorRunsUsage`.

### Fork-Aware Usage

When Session B forks Session A at turn 5:

- `forkBaseUsage` records parent's cumulative at fork point
- On `/bureau-usage`, fork's total = fork's cumulative - `forkBaseUsage`
- `usageSnapshots` (saved after every turn) enable finding the exact snapshot at the fork point

## File Storage

Files are stored in `~/.bureau/logs/{agentId}/files/` with SHA256 deduplication:

1. Filename is sanitized (strip paths, replace unsafe chars).
2. If same name exists with same content (SHA256 match), reuse.
3. If same name with different content, add numeric suffix (`file_2.png`).
4. Max 20MB per file.

Legacy `images/` directory is still served for backward compatibility.

## Env File Parsing

Minimal dotenv parser supporting:

- `KEY=VALUE` format
- `export` prefix
- Single/double-quoted values (with `\n` escape in double quotes)
- Comments (`#`)
- Inline comments after whitespace
- BOM stripping

Throws with line-number context on parse errors.

## Agent History (`agent-history.json`)

Tracks last-known name and room for killed agents. Used by `/bureau-usage` to attribute historical token spend to the correct room, even after the agent is gone. Entries are never removed.

```json
{
  "agent-123": {
    "name": "OldAgent",
    "lastRoomId": "a1b2c3d4",
    "lastRoomName": "Room 1"
  }
}
```

## Office Config Migration

On first load, if `office-prompt.md` exists but `office-config.json` doesn't, the legacy `.md` content is folded into the JSON config. The `.md` file is left in place as a one-time backup.

## Related Docs

- [Server Architecture](server-architecture.md) — How the server reads/writes these files
- [Agent Lifecycle](agent-lifecycle.md) — Session creation and resume flow
- [Conversation Branching Design](../features/conversation-branching-design.md) — Fork mechanics
