# Full Feature List

This is the consolidated operator-facing feature inventory. Design details live
in the architecture and feature docs linked from [docs/README.md](../README.md).

## Multi-Provider

- Choose Claude, Codex, or OpenCode when spawning an agent.
- Mix providers across desks in the same office.
- Agent and schedule dialogs load model choices and effort capabilities for the
  session environment (office and managing user, plus room overrides for agents).
  Unavailable catalogs show built-in choices
  with a notice. Claude Haiku uses 5.5 on direct access; supported effort settings
  reach Claude sessions. Limited Bedrock/Vertex aliases omit unsupported effort
  and use Default (ask) when Auto was selected, without enabling Bypass.
- Use existing CLI authentication where available. Codex runs through Bureau's
  bundled `@openai/codex` launcher and isolated `CODEX_HOME`.
- Account → Connections shows Claude/Codex connection status for the signed-in
  user, accepts API keys into personal managed env (no secret echo), and points
  at host CLI login. Status probes are time-bounded so the pane never sticks on
  "Checking…"; a timed-out check stays offerable for CLI guidance and is not
  status-cached. A process-local per-provider "sign-in in progress" slot lets
  another member see who is following host CLI login (holder name + start time;
  sentence composed client-side). Full browser/device OAuth login remains
  deferred. Auth-failure chat notices deep-link to Connections. Claude recognizes
  API keys, OAuth tokens, and auth tokens in the effective environment. On macOS,
  a missing credentials file triggers a bounded local Keychain status check; an
  inconclusive check stays unavailable rather than claiming the user is signed out.
  Refresh and login guidance recheck status so a fresh sign-in is recognized.
- OpenCode uses the host `opencode` binary on PATH (or `OPENCODE_BINARY`) plus
  `OPENCODE_API_KEY` / host `opencode auth login` — the CLI is not bundled.
- OpenCode requests and silent event streams stop waiting after 30 seconds.
  Heartbeats keep long turns alive. A failed subscription may recover before
  sending the prompt; a submitted prompt is never automatically replayed.
  Recovery waits for other active turns, and a slow health probe alone does
  not restart a process whose identity still matches.
- OpenCode shares model catalog loads for the same server and working directory.
  Supported effort settings reach the model as variants, and context usage uses
  the catalog's model limit. If the catalog is unavailable or a model advertises
  effort variants that exclude the selected level, the turn uses the model's
  default effort with a notice. Models without effort variants use their default.

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
  rate-limited, with honest acks). Any agent can also stop another agent's
  turn without a message, under the same rate limit; the stopped agent is told
  an agent did it.
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
  reports. `/help` opens a compact chat card with a read-only modal (docs +
  short tips; Bureau Skills / User Skills).
- Composer skills browser with filterable commands and skills, plus per-user
  most-used counts for quick access to go-to workflows across devices.

## Multi-User And Multi-Device

- Invite-link authentication with owner and member roles.
- Active session revocation and one-time invite management.
- Live user/device presence in the office.
- **Pager**: agents (`POST /api/pager`) and apps (`POST /api/app/page`) page
  the member responsible for them. Pages live in User Settings > Pager
  (`/pager`), badge the settings vent, and are delivered to the member's
  Discord webhook until acked or resolved. Resolved entries remain available
  as incident history. See `docs/features/pager.md`.
- Office-wide **Team chat** (`/team-chat`) for signed-in humans — monthly JSONL
  under `~/.bureau/members-chat/`, cookie session only (no agents / API tokens).
- **Lobby** isometric scene (tab + Room 1 left door): warm wood lobby; click the
  receptionist chip to open Team chat. Presence uses sentinel room id `lobby`.
- Room lists in user settings follow your tab order, then show other accessible
  rooms in office order, including when an owner edits another member.
- Full-page user settings for profiles, access, self-service device links,
  personal API tokens, provider Connections (Claude/Codex status + API keys),
  ghost appearance, saved language preference (English / Spanish / Catalan /
  Simplified Chinese; UI chrome follows the same preference), and roster
  online/session summaries.
- PWA-friendly mobile UI.
- WebSocket sync across all connected browsers. Large transcript replays stream
  in order as each browser drains, followed by live events. Slow connections have
  bounded queues and reconnect if they fall too far behind or access changes.

## Office UI

- Isometric rooms with desks, character sprites, status lights, and animated
  state. Mid-turn desks show screen scroll lines and vessel steam; working
  characters get a face light.
- Desk drinkware signals backend: Claude desks show a mug, Codex desks a teacup on a saucer, OpenCode desks a small flask.
- Room tabs, room settings, drag/move flows, and desk swapping.
- Usage and Storage panes in User Settings (Usage for all signed-in users; Storage prune for owners). Nested Office Settings links removed.
- Theme picker with dark, light, Nord, Dracula, Solarized Dark, and Solarized
  Light themes.
- Seasonal office decorations that appear automatically around Halloween,
  mid-December, and Valentine's Day (override with `?officeDate=` for review).
- Per-room office pets: choose a cat, dog, rabbit, or tortoise and a coat in
  Room settings; legacy coat-only configs migrate to the cat.
- Per-room looks: Office (default) or Hospital — floor, walls, and props change;
  desks, characters, pets, and status lights stay the same. Hospital beds sit
  clear of the desk paint grid.
- Clickable wall affordances: corkboard → Tasks, clock → Schedules, vent →
  Settings, apps plaque → Apps (moon/sun still toggles theme).
- Apps, scheduled jobs/runs, and Pager start filtered to the room they were
  opened from, with an All rooms option. Opening from the lobby shows all rooms;
  direct Pager links also show all rooms so the linked page stays visible.
  App room filtering follows the registering agent's current room; apps without
  a living visible creator remain available under All rooms.
- Keyboard shortcuts `t` (toggle Tasks), `a` (toggle Apps), and `s` (open
  Settings) when not typing.
- Bookmarkable full-page URLs for Tasks (`/tasks`), Schedules (`/schedules`),
  Apps (`/apps`), Plugins (`/plugins`), Team chat (`/team-chat`, alias `/chat`),
  and Settings (`/settings`); agent chats stay on `/`. Legacy `/cronjobs` and
  `/users` still open Schedules / Settings.
- Topic labels so long-running agents remain recognizable at a glance.
- Mobile agent list view for smaller screens.

## Conversation

- Sticky last-human ask banner in chat: pins the most recent human composer message above the viewport (skips agent / app / cron / API-token user messages).
- Task ids in chat become chips that open the task board on that task; the description field expands to a near-fullscreen editor.
- Room settings saves require the version from a preceding GET (HTTP and the settings dialog), matching office settings optimistic concurrency.
- Markdown, syntax highlighting, Mermaid diagrams, LaTeX math, citations, and rich cards.
- Collapsible thinking/tool-call cards with timing.
- File attachments via path notices, inline image display, and PDF handling.
- Voice input and speech synthesis where supported by the browser, using the
  signed-in user's saved language preference when set (en / es / ca / zh).
- Office UI localization (English, Spanish, Catalan, Simplified Chinese) via typed catalogs and
  `LanguageProvider` — header/nav, settings shell, Connections, panel titles,
  spawn/edit agent dialogs, and related empty states.
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

- Embedded terminal per agent, inheriting the agent owner's managed
  environment and standard copy/paste shortcuts across platforms.
- Built-in file editor with tabs, syntax highlighting, empty-state guidance,
  dirty-buffer tracking,
  and external-change detection. On desktop, selecting code shows a Cite pill
  that quotes the selection into the chat input under its path and line range.
- Rich diff cards via `/bureau-diff`.
- Copy-to-terminal cards for commands an agent wants to hand to the user.
- File-view cards for agent-exposed files.
- Browser preview cards for local/private development URLs.
- Experimental interactive agent browser (opt-in `experimental.browserPanel` in
  Office Settings, off by default): `POST /api/agents/:id/browser` for
  goto/snapshot/click/fill/press/screenshot/close against the same local/private
  - allowlist URL policy. Uses host Chrome via Playwright (Chromium not bundled).
    Side panel streams live CDP JPEG frames; managers can type, drag-select, and copy selection.
    The page closes after 15 idle minutes unless someone is watching, and can be reopened.
- Local `curl` calls to Bureau affordance endpoints render as readable
  tool-call summaries with key payload fields.

## Scheduling And Persistence

- Cron jobs with daily, weekly, and interval schedules, or On demand for
  saved jobs that run only when you choose Run now.
- Account → Variables pane for each signed-in user’s managed env (overrides office variables).
- User-facing "Schedules" naming for cron jobs (header, panels, dialogs); APIs stay `cronjob`.
- Privileged agents can create/update/delete/run schedules owned by their manager; the office-wide schedules prompt stays boss-only.
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
