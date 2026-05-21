---
name: bureau-peer-review
description: Read another agent's current conversation and give feedback on how they're doing. Optionally takes an agent name as a parameter.
---

Review another agent's ongoing conversation and provide feedback. Note: reading a full conversation log can be token-hungry. Be selective about what you read — skim or skip thinking entries and tool results where possible.

1. If a peer name was supplied, look up their agent ID in `~/.bureau/agents-summary.json` (match name case-insensitively). Otherwise try to infer the peer from context — e.g., an agent the boss and you have already paired or consulted with in this session. If there's a clear inference, use it (and briefly confirm who you picked). Otherwise, list candidates (prefer agents whose `cwd` matches yours) and ask the boss to pick. You need the peer's agent ID to read their session and provide feedback.
2. Find the target agent's current session: read sessions.json in their logDir to identify the most recent session.
3. Read the session's JSONL log file from the agent's logDir. These log files can be large. Use your judgment about whether to skip parts of it — thinking entries and tool_result content are the noisiest and can often be skipped or skimmed. Focus on user messages, assistant text, and tool call names/arguments.
4. Provide feedback to the user focused on:
   - Is the agent on track toward what the user asked for?
   - Are there any bugs or mistakes in what it's produced so far?
   - Any red flags like going in circles or ignoring user feedback?
5. If appropriate, give the user advice on how they can help the agent (e.g. clarify instructions, unblock it, correct course).
