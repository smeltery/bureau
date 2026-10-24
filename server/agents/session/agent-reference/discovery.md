# Agent Discovery And Conversations

- `GET /api/agents` lists agents visible to your manager. Live entries include room, backend, model, permission mode, and in-flight turn status. Model and permission mode reflect launch settings, including cloud alias targets and permission fallback; the saved family and preference are unchanged.
- `GET /api/agents/<id>/logs` lists sessions. Add `?q=...` to search, `?session=<id>` to read a session, and `around=<entryId>&window=N` to read near one entry.
- Session indexes and retrieved conversations include a `summary` when available. Search returns separate `summaryHits` for matching topics or summaries, alongside entry `results`; kind and tier filters apply only to entries.
- Indexes accept `limit` (1–200, default 20) and timestamp bounds, and report `truncated` when more sessions match.
- Search filters include `regex=1`, `tier=prompts|conversation|full`, `kind=user_message,text,tool_result`, and `before` / `after` millisecond timestamps.
- `GET /api/agents/<id>/instructions` reads custom instructions and their version for visible agents.
- `GET /api/agents/<your-id>/context` reads context usage when the backend has reported it.

A search while an agent is mid-turn sees only what is already on disk, so say when the count was taken.
