# Automatic handoff

Enable **Automatic handoff** when creating an agent or in its settings. Set its
**Token limit** to a whole number from 50,000 to 10,000,000 (default: 500,000).
The switch and limit survive restarts and reviving the agent. Turning the switch
off preserves the saved limit. Automatic handoff is off by default.

The spawn API (`POST /api/agents`) and edit API (`PATCH /api/agents/:id`) accept
`{ "autoHandoff": true, "autoHandoffTokens": 250000 }`. Omitted fields retain
existing settings; invalid values return HTTP 422 before changing the agent.
Changing the limit takes effect at the next context check; it does not restart
the current conversation.

After a successful turn, Bureau checks the context window. At 85% full or the agent’s token
limit, whichever comes first, it asks the agent for one concise handoff brief in
the old conversation. When OpenCode reports an earlier compaction point, Bureau
reserves another 5% of the context window before that point for writing the brief.
The brief includes the goal, next steps, working state, decisions, open questions
and pointers. It omits a retrospective and material already in persistent prompts
or memory.

A completed, nonempty brief opens a fresh conversation and arrives ahead of queued
messages. Old conversations remain in history. The normal member usage cap also
applies to the brief turn. Successful automatic handoffs appear in the audit log.

Stop and session replacement cancel a pending attempt. An empty or failed brief
leaves the old conversation in place and prevents another automatic attempt in
that conversation; use `/handoff` manually or start a new conversation. If a fresh
conversation is already over its threshold, automatic handoff pauses instead of
looping. Reduce persistent instructions or choose a model with a larger window.
