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
- Agents can read other agents' logs and send messages to one another.
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
- Owner-controlled privileged operator tokens for selected agents, giving those
  agents server-side authorization for explicit office-management requests.
- Office-wide, room-level, and per-agent prompt composition.
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
  ghost appearance, and roster online/session summaries.
- PWA-friendly mobile UI.
- WebSocket sync across all connected browsers.

## Office UI

- Isometric rooms with desks, character sprites, status lights, and animated
  state.
- Room tabs, room settings, drag/move flows, and desk swapping.
- Theme picker with dark, light, Nord, Dracula, Solarized Dark, and Solarized
  Light themes.
- Topic labels so long-running agents remain recognizable at a glance.
- Mobile agent list view for smaller screens.

## Conversation

- Markdown, syntax highlighting, Mermaid diagrams, citations, and rich cards.
- Collapsible thinking/tool-call cards with timing.
- File attachments via path notices, inline image display, and PDF handling.
- Voice input and speech synthesis where supported by the browser.
- Per-agent drafts and queued message chips, including restart-surviving queued
  messages and Ctrl/Cmd+Enter send-now delivery.
- Device-gated Slide Mode presents each agent conversation as a per-turn deck
  with saved per-agent position.
- Conversation branching by editing a past user message.
- Session resume, new conversation, model/effort changes, and usage views.

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

- Claude safety hooks for destructive shell commands, Bureau state protection,
  and secret-file reads.
- Plugin hooks around agent turns with deterministic prefix ordering and
  isolated plugin failure logging.
- Per-agent MCP access design and plugin-management design docs for future
  expansion.
