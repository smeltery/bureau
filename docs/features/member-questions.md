# Member questions and Inbox

**User Settings → Inbox** combines questions that can wait, pending masked
credential requests, and urgent pages. `/inbox` opens it directly; `/pager`
remains supported. The settings badge counts questions needing attention,
credential requests and open urgent pages. Questions also appear above the
addressed member's chat composer. Lists refresh every ten seconds and on focus.

Agents create questions with their own bearer at
`POST /api/agents/<agentId>/questions`. A question goes to the agent's manager by
default; `member` can name another member with access to the room. Only that
member can read or answer it through the Inbox, including when another viewer
is an office owner. Agents can read and edit their own questions. Room access
is checked again on every request and immediately before reply delivery.

```json
{
  "prompt": "Which release should I prepare?",
  "options": ["Stable", "Preview"],
  "recommended": "Stable"
}
```

Prompts allow 1–4000 characters. Optional choices have 2–4 distinct labels of
at most 80 characters; a recommendation must match a label. Members can always
type their own answer. `link` accepts the office Tasks, Apps, Schedules,
Settings, Inbox or Pager page, with a simple query string. File previews,
editor links and copy-to-terminal cards use the existing conversation
features; Open conversation takes the member to that context.

Agents use GET on the collection or individual question to read it, PATCH
with its current `revision` to edit it, and DELETE with the revision to cancel
an unanswered question. `options: []`, `recommended: null`, and `link: null`
clear those values. Changing choices clears the old recommendation unless a
new one is supplied. There is a limit of 50 open questions per agent. Agents
cannot alter or delete a member's saved answer.

## Answers and delivery

Members answer or dismiss a question from the card. A dismissal may include a
reason. The answer is attributed to the member and queued with the original
question text. A pending permission or model selection refuses delivery;
retry after finishing that prompt. Replies are tied to the conversation that
asked the question. If the agent starts a different session, the answer stays
saved and the member can open the new conversation to follow up manually.

Answers are saved before attempting delivery. Repeated submissions of the same
answer return its saved result without sending again. Failed delivery leaves
an explicit retry action. If delivery was interrupted or its final receipt
could not be written before a restart, the UI says the result is uncertain.
The member must check the conversation and explicitly confirm a resend; the
server never retries an uncertain answer automatically. This avoids claiming
exactly-once delivery across separate storage and provider operations.

Sent answers can be shown in Inbox history and removed by the addressed member.
Removing a receipt does not delete the message from the agent's transcript.
Edits use revision checks. If an agent changes a question while the member is
typing, the draft stays intact and the member must review the updated question
before sending.

Questions and answer receipts persist atomically in `questions.json` under the
office state directory and are included in normal backups. Invalid or unreadable
storage is left intact and operations fail with a server-log error. Repair or
restore the file rather than replacing it with an empty list. Credential
requests retain their existing expiry and session-bound lifecycle; their values
never enter the question store or ordinary replies.

## Member API

These endpoints require a browser session, including on localhost:

- `GET /api/questions` lists only the member's visible questions and receipts;
  optional `agentId` narrows the list.
- `GET /api/questions/<id>` reads one.
- `POST /api/questions/<id>/answer` takes `revision` and `text` (1–8000 characters).
- `POST /api/questions/<id>/dismiss` takes `revision` and optional reason in `text`.
- `POST /api/questions/<id>/retry` retries the saved answer; an uncertain result
  also requires `confirmedUncertain: true` after checking the conversation.
- `DELETE /api/questions/<id>` takes `revision` and removes an answered receipt.

Personal API tokens and agent bearers cannot answer as a member. Pending
credential cards are listed separately by `GET /api/integrations/requests` for
the responsible signed-in member, and continue to use their masked form.
