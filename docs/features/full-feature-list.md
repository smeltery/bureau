# Full Feature List

This is the consolidated operator-facing feature inventory. Design details live
in the architecture and feature docs linked from [docs/README.md](../README.md).

## Multi-Provider

- Choose Claude or Codex when spawning an agent.
- Mix providers across desks in the same office.
- Use existing CLI authentication where available. Codex runs through Bureau's
  bundled `@openai/codex` launcher and isolated `CODEX_HOME`.

## Multi-Agent

- Persistent agent desks with names, rooms, working directories, models,
  topics, and status.
- Bearer-authenticated agent discovery manifest for inter-agent awareness.
- Agents can register web apps they built; Bureau allocates the port, supervises
  the process past sessions and reboots, and shows state and logs in the Apps
  tab. Each app can message the agent that built it. See
  [Agent-built apps](agent-apps.md).
- Agents can read other agents' logs and send messages to one another, choosing
  between queueing behind the receiver's turn and steering (interrupting it,
  rate-limited, with honest acks).
- Agents can schedule one-off future messages, including self-reminders.
- Durable shared memory with office, room, person, and agent scopes. Agents can
  append attributed facts through the local API, users can curate raw memory in
  settings dialogs, and relevant notes load into future agent prompts.
- `/bureau-message <agent> <text>` drops a message straight into another
  agent's chat (attributed to the sending desk; queues if the target is busy).
- Messages from humans and agents share one receiver queue while an agent is
  busy; queued messages are persisted with the agent record and replay after a
  Bureau restart.
- Shared task board with create, room assignment, claim, backlog, and done
  states.
- Owner-controlled privileged operator tokens for selected agents. A privileged
  token is accepted on the office-management routes — room create (owner
  managers only), rename, close, settings and desk swaps; agent spawn, kill,
  edit, move and topic; and conversation steering (resume, new conversation,
  send-now, dequeue) — always scoped to the rooms and agents the agent's manager
  can see. It is refused on office settings and external access, invites,
  browser sessions, user records, view preferences, the terminal, and the
  privilege toggle itself, so no agent can widen its own authority.
- Office-wide, room-level, and per-agent prompt composition. Office settings
  saves require the version from a preceding GET (HTTP and the settings dialog)
  so concurrent owner tabs cannot clobber each other; room settings and custom
  instructions use the same optimistic-concurrency rail.
- Bundled collaboration skills and Bureau slash commands, including peer
  review, pair programming, soft handoff, subagent review, and guided Bureau bug
  reports.
- Composer skills browser with filterable commands and skills, plus per-user
  most-used counts for quick access to go-to workflows across devices.

## Multi-User And Multi-Device

- Invite-link authentication with owner and member roles.
- Active session revocation and one-time invite management.
- Live user/device presence in the office.
- Full-page user settings for profiles, access, self-service device links,
  personal API tokens, ghost appearance, saved language preference, and roster
  online/session summaries.
- PWA-friendly mobile UI.
- WebSocket sync across all connected browsers.

## Office UI

- Isometric rooms with desks, character sprites, status lights, and animated
  state.
- Desk drinkware signals backend: Claude desks show a mug, Codex desks a teacup on a saucer.
- Room tabs, room settings, drag/move flows, and desk swapping.
- Usage and Storage panes in User Settings (Usage for all signed-in users; Storage prune for owners). Nested Office Settings links removed.
- Theme picker with dark, light, Nord, Dracula, Solarized Dark, and Solarized
  Light themes.
- Seasonal office decorations that appear automatically around Halloween,
  mid-December, and Valentine's Day (override with `?officeDate=` for review).
- Per-room office pets: choose a cat, dog, rabbit, or tortoise and a coat in
  Room settings; legacy coat-only configs migrate to the cat.
- Clickable wall affordances: corkboard → Tasks, clock → Schedules, vent →
  Settings, apps plaque → Apps (moon/sun still toggles theme).
- Keyboard shortcuts `t` (toggle Tasks) and `s` (open Settings) when not typing.
- Topic labels so long-running agents remain recognizable at a glance.
- Mobile agent list view for smaller screens.

## Conversation

- Sticky last-human ask banner in chat: pins the most recent human composer message above the viewport (skips agent / app / cron / API-token user messages).

- Room settings saves require the version from a preceding GET (HTTP and the settings dialog), matching office settings optimistic concurrency.
- Markdown, syntax highlighting, Mermaid diagrams, citations, and rich cards.
- Collapsible thinking/tool-call cards with timing.
- File attachments via path notices, inline image display, and PDF handling.
- Voice input and speech synthesis where supported by the browser, using the
  signed-in user's saved language preference when set.
- Per-agent drafts and queued message chips, including restart-surviving queued
  messages and Ctrl/Cmd+Enter send-now delivery.
- Device-gated Slide Mode presents each agent conversation as a per-turn deck
  with saved per-agent position. Each settled turn is formatted into one
  self-contained HTML slide by a second, cheap-tier model pass, generated on
  demand for the slide you are looking at (never eagerly for the whole
  conversation), cached per conversation, and rendered inside a sandboxed
  iframe under a deny-everything CSP. Per-slide regenerate accepts a one-shot
  instruction.
- Conversation branching by editing a past user message. Offered only where the
  backend can fork a session: the Claude backend can, so Claude agents show edit,
  and the Codex backend cannot, so Codex agents show no edit affordance and the
  server refuses the command. Ephemeral slash-command echoes (unknown /
  unsupported commands) are an exception: editing them trims the failed echo and
  re-dispatches without a fork, including on Codex and before a session exists.

- Session resume, new conversation, model/effort changes, and usage views.
- Humanized backend death notices in chat when a Claude/Codex subprocess exits
  on SIGTERM/SIGKILL or another signal, or when the harness reports
  `error_during_execution`. Ordinary exit codes and unrecognized failures stay
  verbatim; the original backend string is kept in log metadata for diagnosis.
- Boss-facing ephemeral context wrap-up notices at 50%/75% (50% size-gated to
  windows ≥ 500k tokens), pointing at `/clear` and `/handoff`, separate from the
  agent-facing context budget nudge.

## Developer Tools

- Embedded terminal per agent, with standard copy/paste shortcuts across
  platforms.
- Built-in file editor with tabs, syntax highlighting, empty-state guidance,
  dirty-buffer tracking,
  and external-change detection.
- Rich diff cards via `/bureau-diff`.
- Copy-to-terminal cards for commands an agent wants to hand to the user.
- File-view cards for agent-exposed files.
- Browser preview cards for local/private development URLs.
- Local `curl` calls to Bureau affordance endpoints render as readable
  tool-call summaries with key payload fields.

## Scheduling And Persistence

- Cron jobs with daily, weekly, and interval schedules.
- User-facing "Schedules" naming for cron jobs (header, panels, dialogs); APIs stay `cronjob`.
- One-off scheduled agent messages persist in `scheduled-messages.json`.
- Per-run transcripts, manual run-now, resume, and fork from prior runs.
- File-system persistence under `~/.bureau/` or `BUREAU_HOME`.
- Daily backup tarballs with retention.
- Owner storage reports via `/bureau-storage` and `GET /api/storage/usage`,
  covering transcripts, attachments, Codex home, memory, cron jobs, backups,
  and per-agent stored data.
- Owner-triggered `POST /api/storage/prune` dry runs and explicit applies for
  old transcripts or orphaned attachments, with active sessions, fork ancestors,
  newest retained sessions, referenced attachments, and queued attachments
  protected.

## Safety And Extensibility

- Office process renames itself to `bureau` on Linux so name-based OOM
  protection can distinguish the server from agent `bun` builds, alongside
  descendant `oom_score_adj` biasing.
- Codex escalation prompts offer allow-once, allow-for-this-session, deny, and
  allow-every-command-starting-with-a-prefix for the rest of the session. Prefix
  rules are held in the session's memory and die with it — Bureau never writes a
  durable Codex policy amendment, which would turn one person's "stop asking"
  into a permanent office-wide allow. A typed prefix must be a whole-token prefix
  of the command actually being approved, and only plain argv commands (no
  quoting, chaining, redirection, globbing or expansion) can match or be stored.
- Claude safety hooks for destructive shell commands, Bureau state protection
  (including shell cwd-set tracking so relative writes after `cd` cannot sneak
  into `~/.bureau/`), and secret-file reads.
- Write-path secret redaction in agent and cron conversation logs (provider tokens and common `api_key`/`secret`/`token`/`password` assignments), without rewriting history.
- Plugin hooks around agent turns with deterministic prefix ordering and
  isolated plugin failure logging.
- Per-agent MCP access design and plugin-management design docs for future
  expansion.
