# App chat view

Chat uses the normal conversation controls, including attachments and approvals.
On a phone, opening chat occupies the page; closing it returns to the app. Drafts
are kept in the tab session and separated by user, app generation and assigned
agent. Recreating an app or handing it to another agent does not reuse a draft.
An app whose assigned agent is gone or inaccessible remains usable without chat.

The sign-in flow visits the app origin to set its own cookie, then returns to
the office short URL. Recovery is limited to once per minute. If cookies are
blocked, enable them and use **Reconnect app**; **Open app** opens the isolated
app directly. Access and assignment are rechecked every 30 seconds and on office
updates. A denied refresh removes both app and chat. Existing server-side checks
still authorize every chat action and app request.

App response framing policy permits only the configured office origin while
preserving other CSP directives. The frame cannot navigate the top-level office
or read its DOM. Session-required messages are accepted only from that frame
and its exact origin; no app content is injected into the office page.

`GET /api/apps/:name/chat-view?generation=N` requires a browser session and an
exact app generation. It returns only app URL, assigned visible agent and app
session expiry, never app commands, paths, credentials or chat history.

Validation: `flox activate -- bun run build:ui` then
`flox activate -- node scripts/test-app-chat.mjs` exercises the real UI in Chrome
against local request fixtures, without a provider account or live app.
