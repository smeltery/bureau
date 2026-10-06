# Bureau

An isometric 2D office UI for managing multiple concurrent Claude Code agents. Each agent sits at a desk in a browser-based office. The core abstraction separates the **agent** (persistent identity) from the **conversation** (ephemeral task).

Read the [design and architecture article](articles/punching-in-building-an-office-for-ai-agents.md) for a full feature overview.

## How to develop

- **Toolchain:** pinned via a Flox env (`.flox/env/manifest.toml`) — Bun + node-pty build deps, locked so local matches CI. `flox activate` enters it (and `bun install`s on first run); commands can run through it with `flox activate -- <cmd>`. Plain `bun` works too if you have a matching version. See `docs/contributing/development.md`.
- **Auto-reload dev mode:** `bun run dev`. This runs UI watch-build + server watch-restart together, and live-refreshes local browser tabs on UI rebuilds.
- **Manual fallback:** `bun run dev:manual` (single build + server run).
- **Rebuild UI only:** `bun run build:ui`. This bundles JS, copies `index.html`, and copies `xterm.css` into `ui/dist/`. The server reads from `ui/dist/` on each request — no restart needed. **Do NOT build to `ui/index.js`; that path is not served.**
- **Restart server:** user service: `systemctl --user restart bureau`; system service: `sudo systemctl restart bureau`. This kills the process all agents run on — every active agent session is interrupted. The user will need to proactively continue any in-progress conversations afterward.
- **URL:** http://localhost:4000 (server machine) or http://TAILSCALE_SERVER_ALIAS:4000 (laptop, phone, etc.)
- **Debug agent issues** by reading logs at `~/.bureau/logs/<agentId>/<sessionId>.jsonl` — don't ask the user to copy-paste.
- **Don't ask the user to run commands — just do it.**
- After completing a feature or batch of fixes, offer to the user to commit and push.

## Key decisions (do not revisit)

- Single Bun process (no Node) — serves UI, manages agents in-process via SDK, talks to browser over WebSocket.
- Agent SDK stable `query()` API (streaming-input mode), wrapped by `RawClaudeSession` in `server/backends/claude.ts` to expose a `send()`/`stream()`/`close()` session shape. Subscription auth. Migrated from the alpha `unstable_v2_*` surface when the SDK reached 0.3.x — `query()` consumes a push-able `AsyncIterable<SDKUserMessage>` prompt for the session's lifetime; each pushed message drives one turn.
- Primarily WebSocket. Lightweight HTTP endpoints exist where needed (e.g. task board API).
- React/SVG for rendering. No Vite. Bun's bundler, manual refresh.
- No database. In-memory state, flat file logs, `agents.json` for persistence.
- 8 desks max. Agent = persistent identity (name, desk, outfit, cwd). Conversation = ephemeral SDK session.
- Agents persist across restarts. Auto-resume last conversation on startup.
- Keep agent system prompts stable for the lifetime of a session. Anything that changes per turn, such as live handles, nonces, timestamps, or status snapshots, belongs in the user turn or an API response instead of the system prompt; changing the prompt defeats provider prompt caches.
- Multi-provider: Claude (Opus/Sonnet/Haiku/Fable families) and Codex (GPT-5.x) selectable per agent, plus OpenCode (`provider/model` via host `opencode` CLI), plus per-agent effort level. Default: Opus (currently `claude-opus-5`), `xhigh` effort. Model families resolve to exact versions centrally via `FAMILY_TO_MODEL` in `shared/types.ts`.
- SDK spawns CLI subprocesses which inherit the user's global Claude skills and MCP config.
- Agents can message each other (`POST /api/agents/:id/message`, queue-aware — flushes when the target is idle; also the `/bureau-message` command and the handoff/peer skills) and read each other's logs. There is no separate comm bus; messages land in the target's normal chat.
- Not in scope: remote agents (we support remote connections via Tailscale instead), a CLI bureau tool.

## Project layout

- `server/` — Bun HTTP + WebSocket server, agent lifecycle, SDK integration
- `ui/` — React frontend
- `demo/` — Standalone demo app sources and build output
- `shared/` — TypeScript types shared between server and UI
- `website/` — Marketing website (Vite + React, prerendered to static HTML), deployed via Vercel.
- `docs/` — Design documents, plans, and reference material
- `skills/` — Claude Code skills bundled with the project, available to any bureau agent
- `articles/` — Blog-style articles about the project

### Key paths

- `~/.bureau/agents.json` — persisted agent configs
- `~/.bureau/logs/` — agent conversation logs
- `~/.bureau/launchers/` — launcher scripts (cwd workaround for SDK - details in docs/investigations/sdk-investigation.md)
- `ui/dist/` — UI build output (gitignored)

## Shipping a user-visible feature

When a feature lands, several places describe Bureau to its various audiences. They drift apart easily — walk this list before merging:

1. **`README.md`** — feature list and/or documentation links. Audience: anyone landing on the GitHub repo.
2. **`articles/punching-in-building-an-office-for-ai-agents.md`** — only if the change is architecture-level (SDK upgrades, lifecycle changes, new subsystems).
3. **`docs/README.md`** — if you're adding a new design doc, register it in the appropriate table (`architecture/`, `features/`, `investigations/`, or `contributing/`).
4. **`docs/features/` or `docs/architecture/`** — add the design doc itself.
5. **Landing page** — `website/src/App.tsx` plus the section components in `website/src/components/*`. Only update if the feature belongs on the marketing-headline list. Vite app, deployed via Vercel. The OG image (`website/public/og.png`, also embedded in `README.md`) is generated from `website/scripts/og.tsx` — rerun `bun scripts/og.tsx && npm run og` in `website/` if the office art or headline changes.
6. **Site chatbot system prompt** — the `SYSTEM_PROMPT` constant in `api/chat/system-prompt.ts` (`api/chat.ts` is just a re-export of the handler). The prompt has a "never make up features" rule, so stale content here makes the bot lie by omission — and a "not yet supported" line that has since shipped makes it deny a real feature outright. Vercel Edge function; redeployed with the site.
7. **`/help` slash command** — `server/agents/conversation/slash-help.ts` (`handleHelpCommand`). It renders from the `server/agents/commands.ts` registry rather than a hardcoded list, so adding a command there is usually enough; keep that registry's `description` fields accurate, since they show up both in `/help` and in the autocomplete UI.

The non-obvious touchpoints are 5, 6, and 7 — those are the ones contributors forget. The first four are easy to find by `ls`.

### Other places that describe behavior (and silently fall stale)

- `server/agents/session/system-prompt.ts` `buildSystemPrompt()` — the system prompt injected into every spawned agent. Update when an agent's role or capabilities change.
- `server/cronjobs/index.ts` `buildCronjobSystemPrompt()` — the system prompt injected into every cronjob run. Update when the cronjob's role or discovery hints change; that function is a thin wrapper, so the prompt text itself lives in `server/cronjobs/system-prompt.ts`.
