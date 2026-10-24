# Members team chat

Office-wide chat for signed-in humans. Agents never post here.

## Storage

Messages live under `~/.bureau/members-chat/` as monthly JSONL files
(`YYYY-MM.jsonl`). Ordering is append order within each month; edits, deletes,
and pins append new ops to the month that owns the message id (ids embed
`YYYYMM`). Per-member read positions are atomically saved in `reads.json`.
Positions advance through message order and survive deletion of the anchor
message; delayed updates cannot move them backward.

## HTTP

Cookie browser session required. API tokens, loopback agent callers, and agent
bearers are refused.

| Method | Path | Notes |
| ------ | ---- | ----- |
| `GET` | `/api/members-chat?before=&limit=` | Page of messages (oldest→newest in the page) plus pinned and the caller’s unread summary |
| `POST` | `/api/members-chat` | Body `{ text, attachments?, replyTo?, device? }` → `201` message |
| `POST` | `/api/members-chat/uploads` | Multipart files; returns attachment metadata |
| `GET` | `/api/members-chat/files/:filename` | Browser-authenticated file, with untrusted-content headers |
| `POST` | `/api/members-chat/read` | Body `{ lastReadId }`; marks through that message for the caller only |
| `PUT` | `/api/members-chat/:id/pin` | Owner only; body `{ active?: boolean }` |
| `PUT` | `/api/members-chat/:id` | Author only; body `{ text }`; edits in place |
| `PUT` | `/api/members-chat/:id/thumbs-up` | Body `{ active: boolean }`; changes only the caller’s reaction |
| `DELETE` | `/api/members-chat/:id` | Author or owner |

## WebSocket

Connected browsers receive:

- `members_chat_message` — new post, edit, reaction, or pin/unpin with `updateOnly: true`
- `members_chat_deleted` — `{ id }`
- `members_chat_summary` — `{ summary: { userId, readPointer, unread, latestId } }`, sent only to that member’s sockets after a read update. Posts and deletions refresh each connected member’s own summary.

`full_state.membersChat` supplies the recipient’s summary on connect or reconnect.
The closed chat does not fetch history to show an unread badge.

## UI

Full-page panel at `/team-chat` (alias `/chat`). Header **Team chat** on
desktop; mobile overflow menu. Humans only — no agent composer.

Unread counts appear on the desktop entry, lobby receptionist, mobile menu,
and open chat header. A visible chat marks through its newest displayed
message only while scrolled to the bottom. Reading older messages or hiding
the browser tab keeps incoming messages unread. Read updates sync across
the member’s tabs; failed updates show a retry action.

The composer grows with the draft, then scrolls after eight lines on mobile
(200 pixels on desktop). Mobile Enter inserts a newline; use Send to post.
IME composition never sends a message. Desktop Enter sends; Shift+Enter
inserts a newline, while Ctrl+Enter and Command+Enter do not send.

Use **Reply** on a message to quote its author and excerpt above your draft.
Canceling a reply keeps the draft text. Posted quotes remain readable after
the original is deleted; click a quote to jump to its original when loaded.
A failed send preserves the draft and reply selection. If the target was
deleted before posting, cancel the reply to send the text as a new message.

Authors can edit their own messages in place. Saving updates connected tabs,
preserves pins and existing reply quotes, and does not add unread messages.
Owners cannot edit someone else’s text. Failed saves keep the editing draft;
Cancel discards it without changing the posted message.

Members can add or remove one thumbs-up per message. Counts and reactor names
sync across browsers and persist after restart. Repeating the same desired
state is harmless; reactions never add unread messages. Failed requests show
a retry hint beside the button without discarding the current reaction state.

Attach files with the paperclip, paste, or drag and drop. Uploads are staged
until posted; remove failed or unwanted files before sending. A message may
contain only attachments. Limits are five files per message/upload, 200 MiB
per file, and 400 MiB total. A failed post retains staged files and draft text.

Files and metadata live in `members-chat/files/` under generated names.
Posted metadata is resolved from the saved upload, never trusted from the
client. Inline images and file links require a browser session; active file
types use the same sandbox headers as other Bureau attachments. Uploaded
files remain stored when a message is deleted.
