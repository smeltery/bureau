---
name: loose-ends
description: Recap current work, pending member decisions and completed results without closing the conversation. Use when the member asks for a recap, loose ends, or where things stand.
---

# Session recap

Check the current state of work discussed or delegated in this conversation.
Inspect relevant Git changes and worktrees, running commands, PR checks,
scheduled messages, coworkers' progress, and tasks. Prefer observed state over
an earlier promise or status message. Say which checks could not be completed;
a timeout alone does not establish that a job stopped.

Give a short recap with these groups, omitting empty groups:

- **Needs your input:** decisions or actions that only the member can provide.
  State the recommendation, why it matters, and what it unblocks.
- **In progress:** active or waiting work, who is responsible, and the next
  observable event or action.
- **Completed:** verified outcomes from this conversation, in plain language.

Keep member follow-ups in Bureau's persistent questions as well as the recap.
Read the `questions` agent reference before using the API. List your existing
questions first; reuse or revise an open question for the same decision instead
of duplicating it. Create a question only for an outstanding member action.
Cancel your own obsolete open questions with their current revision, and
refresh after a conflict. Preserve answered receipts. Work waiting on a job,
a coworker, or CI belongs in the recap and does not need a member question.
Use the masked credential-request flow for secrets, never an ordinary question.

Honor authorization already given; do not turn an approved action into another
approval request. A recap does not authorize new implementation, commits,
deployments, or messages to coworkers. Report a useful next action for each
open item without starting unrelated work. If nothing is outstanding, say so
briefly. Keep the conversation open; do not clear it or hand it off.
