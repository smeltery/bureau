# Automatic handoff

Open an existing agent’s settings and enable **Automatic handoff**. The preference
survives restarts and reviving the agent. It is off by default and can also be
changed with `PATCH /api/agents/:id` using `{ "autoHandoff": true }`.

After a successful turn, Bureau checks the context window. At 85% full or 500,000
tokens, whichever comes first, it asks the agent for one concise handoff brief in
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
