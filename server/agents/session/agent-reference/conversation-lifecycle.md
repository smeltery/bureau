# Conversation Lifecycle

- `POST /api/agents/<your-id>/new-conversation` clears your own session.
- `POST /api/agents/<your-id>/handoff` with `{"text":"<brief>"}` starts a fresh session and delivers the brief into it.
- `GET /api/agents/<id>/sessions` lists sessions for agents visible to your manager.
- `POST /api/agents/<id>/resume` resumes a prior session when your token has access.

Use handoff for context-window pressure. Use scheduled messages for real future reminders.

Topic labels stay unchanged as a conversation grows. `PUT /api/agents/<id>/topic` with `{"topic":"<label>"}` sets a label; a blank string clears it. `DELETE /api/agents/<id>/topic` requests a refresh while retaining the current label until generation succeeds. The runtime `topicGenerating` flag reports an in-flight refresh.
