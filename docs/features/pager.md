# Pager

Agents and apps page the person responsible for them when something needs a human and cannot wait for that person to open the office. Bureau keeps each page as durable state and delivers it to the member's Discord, repeating until someone acks or resolves it.

## Who pages whom

| Source | Route                | Token                                | Target              |
| ------ | -------------------- | ------------------------------------ | ------------------- |
| Agent  | `POST /api/pager`    | agent bearer (`$BUREAU_AGENT_TOKEN`) | the agent's manager |
| App    | `POST /api/app/page` | app token (`$BUREAU_APP_TOKEN`)      | the app's owner     |

The token decides the source and the target; the body carries only `title` (required, up to 200 characters), `body` (optional, up to 2000) and `key` (optional, up to 200). Apps have their own route so a page still goes out when the agent that built the app is down.

- **Dedupe.** A raise with the `key` of the source's still-unresolved page updates that page (new text, raise count + 1) instead of opening another. A re-raise never re-opens an acked page. A health check that runs every 15 minutes therefore makes one page per incident.
- **Resolve.** A source resolves its own page with `POST /api/pager/resolve` or `POST /api/app/page/resolve` and `{"key": ...}` or `{"id": ...}`. Members resolve from the UI.
- **Rate limit.** Each source can open at most 20 new pages an hour; re-raises by key are free.

## The page record

Stored in `~/.bureau/pager/pages.json` (`PagerEntry` in `shared/user-types.ts`): id, timestamps, raise count, source (kind, id, name, room), target member, title, body, key, state (`open`, `acked`, `resolved`) with who and when, and delivery status (last attempt, successful sends, last failure class). Webhook URLs and raw responses never land on a page. Resolved pages are deleted after 30 days.

## Delivery

Members configure delivery in **User Settings > Pager**:

- **Discord webhook URL**: an incoming webhook for a channel. It is a credential, so it is write-only in the UI, stored 0600 in `~/.bureau/pager/discord-webhooks.json`, and omitted from backups (the restore report tells members to paste it again). Only `discord.com`/`discordapp.com` webhook URLs are accepted.
- **Discord user id** to @mention, so the phone pings. `allowed_mentions` is limited to that one user.
- **Repeat interval**: every 5 (default), 15, 30 or 60 minutes, or send once.
- **Send test page**.

The server sends a new page immediately, then a 30-second tick repeats open pages on the member's interval. Ack and resolve stop the repeats; resolve also sends a short "Resolved" note if the page was ever delivered. Failures are recorded as `no_webhook`, `http_4xx`, `http_5xx`, `rate_limited` or `network` and retried within a minute; a 429 waits for Discord's `retry_after`. A member with no webhook still sees the page, marked as not delivered, and adding a webhook sends their open pages.

Each message holds the title, body, source and room, the raise count, and a link to `<office>/pager?page=<id>`.

## Reading and acting

`GET /api/pager` lists pages a member can see: pages addressed to them, plus pages whose source room they can see (owners see all). `POST /api/pager/<id>/ack` and `/resolve` act on one. These accept a browser session or a personal API token; delivery settings (`GET/PUT /api/pager/settings`, `POST /api/pager/settings/test`) are browser-session only. A browser on the office machine itself, which authenticates as loopback, is identified by its session cookie.

The UI lists pages in **User Settings > Pager** with a room filter and a resolved toggle, open pages first. `/pager?page=<id>` (the Discord link) opens the section with that page highlighted. The settings vent on the office wall shows a count of the member's open pages. Browsers refetch when the server broadcasts `pager_changed`.

## Not in v0

Server-raised watchdog pages (agent crashes, auth expiry, app crash loops), other channels (Slack, Web Push), escalation to other members, and acking from inside Discord.
