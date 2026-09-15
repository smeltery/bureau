# Members team chat

Office-wide chat for signed-in humans. Agents never post here.

## Storage

Messages live under `~/.bureau/members-chat/` as monthly JSONL files
(`YYYY-MM.jsonl`). Ordering is append order within each month; edits, deletes,
and pins append new ops to the month that owns the message id (ids embed
`YYYYMM`).

## HTTP

Cookie browser session required. API tokens, loopback agent callers, and agent
bearers are refused.

| Method | Path | Notes |
| ------ | ---- | ----- |
| `GET` | `/api/members-chat?before=&limit=` | Page of messages (oldest→newest in the page) plus pinned |
| `POST` | `/api/members-chat` | Body `{ text, replyTo?, device? }` → `201` message |
| `PUT` | `/api/members-chat/:id/pin` | Owner only; body `{ active?: boolean }` |
| `DELETE` | `/api/members-chat/:id` | Author or owner |

## WebSocket

Connected browsers receive:

- `members_chat_message` — new post, or pin/unpin with `updateOnly: true`
- `members_chat_deleted` — `{ id }`

## UI

Full-page panel at `/team-chat` (alias `/chat`). Header **Team chat** on
desktop; mobile overflow menu. Humans only — no agent composer.
