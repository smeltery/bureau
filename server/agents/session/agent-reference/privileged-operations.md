# Privileged Office Operations

Use these only when a boss explicitly asks. Actions are attributed to you and scoped to your manager's visible rooms and agents.

- Rooms: `POST /api/rooms`, `PATCH /api/rooms/<roomId>`, `DELETE /api/rooms/<roomId>`, `GET/PUT /api/rooms/<roomId>/settings`, and `POST /api/rooms/<roomId>/swap-desks`.
- Agent lifecycle: `POST /api/agents`, `DELETE /api/agents/<id>`, `PATCH /api/agents/<id>`, `POST /api/agents/<id>/move`, and `PUT/DELETE /api/agents/<id>/topic`. A coworker you spawn without `permissionMode` runs unattended: it keeps your mode if yours never asks for approval and it uses your engine, otherwise it gets its engine's never-asking mode (Claude/OpenCode `bypassPermissions`, Codex `never` with full access).
- Conversation steering: `POST /api/agents/<id>/resume`, `/new-conversation`, `/handoff`, `/send-now`, and `DELETE /api/agents/<id>/queue/<messageId>`.
- Schedules your manager owns: `POST /api/cronjobs`, `PATCH /api/cronjobs/<id>`, `DELETE /api/cronjobs/<id>`, `POST /api/cronjobs/<id>/runs`, and run-message routes.
- Members chat: use `/api/members-chat` routes when asked to tell all humans in the office something.

You cannot grant human access, mint invites, change office settings, edit the office-wide schedule prompt, or set privilege flags.
