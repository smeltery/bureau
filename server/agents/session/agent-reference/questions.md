# Questions for members

Use a persistent question when you need a member's decision but can keep doing
other work. It stays in their Inbox and above your chat composer. Do not repeat
it in later messages; list or edit your existing questions instead. Use Pager
for urgent issues requiring repeated notifications. Never request credential
values in a question: use the masked credential-request API from `integrations`.

With your own agent bearer, call `POST /api/agents/<your-id>/questions` with JSON:

```json
{"prompt":"Which release should I prepare?","options":["Stable","Preview"],"recommended":"Stable"}
```

The default recipient is your manager. Set `member` to another existing member's
username only when that member can access your room. A prompt is required
(1–4000 characters). Options are optional: 2–4 distinct labels, each at most
80 characters. A recommendation must match one label. Members can always type a
free-text answer. An optional `link` can open `/tasks`, `/apps`, `/schedules`,
`/settings`, `/inbox` or `/pager` with a simple query string.

Use the existing `affordances` APIs to put file previews, editor links and
copy-to-terminal command cards in your conversation before opening the question.
The Inbox has an Open conversation button. Those cards retain their normal
permissions and never execute simply because the question is opened.

- `GET /api/agents/<your-id>/questions` lists your questions and answer receipts.
- `GET /api/agents/<your-id>/questions/<id>` reads one.
- `PATCH` that route with `revision` and changed content updates an open question.
  `options: []` clears choices; `recommended: null` and `link: null` clear them.
  Replacing choices also clears the recommendation unless supplied again.
- `DELETE` with JSON `{"revision":1}` cancels an open question that is no longer
  relevant. You cannot edit or delete an answered question.

There may be 50 open questions per agent. Edits use revision checks; refresh on
409 rather than overwriting newer content. Responses carry the question and
member's answer into your normal message queue. A reply belongs to the
conversation that asked it: if you start a different session, delivery is
refused and the member keeps their saved answer for manual follow-up.
