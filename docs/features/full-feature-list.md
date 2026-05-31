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
- Shared `agents-summary.json` discovery manifest for inter-agent awareness.
- Agents can read other agents' logs and send messages to one another.
- Messages from humans and agents share one receiver queue while an agent is
  busy.
- Shared task board with create, assign, claim, backlog, and done states.
- Office-wide, room-level, and per-agent prompt composition.
- Bundled collaboration skills and Bureau slash commands.

## Multi-User And Multi-Device

- Invite-link authentication with owner and member roles.
- Active session revocation and one-time invite management.
- Live user/device presence in the office.
- Per-user device settings and ghost appearance.
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
- File attachments, inline image display, and PDF handling.
- Voice input and speech synthesis where supported by the browser.
- Per-agent drafts and queued message chips.
- Conversation branching by editing a past user message.
- Session resume, new conversation, model/effort changes, and usage views.

## Developer Tools

- Embedded terminal per agent.
- Built-in file editor with tabs, syntax highlighting, dirty-buffer tracking,
  and external-change detection.
- Rich diff cards via `/bureau-diff`.
- Copy-to-terminal cards for commands an agent wants to hand to the user.
- File-view cards for agent-exposed files.

## Scheduling And Persistence

- Cron jobs with daily, weekly, and interval schedules.
- Per-run transcripts, manual run-now, resume, and fork from prior runs.
- File-system persistence under `~/.bureau/` or `BUREAU_HOME`.
- Daily backup tarballs with retention.

## Safety And Extensibility

- Claude safety hooks for destructive shell commands, Bureau state protection,
  and secret-file reads.
- Plugin hooks around agent turns with deterministic prefix ordering and
  isolated plugin failure logging.
- Per-agent MCP access design and plugin-management design docs for future
  expansion.
