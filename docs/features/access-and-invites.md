# Access and invites

How Bureau gates who can use an office, and how the invite-link flow works end-to-end.

## TL;DR

- Bureau agents can run shell commands, so authenticated users effectively have shell access to the host. Only invite people you trust.
- The server gates every browser request (HTTP + WebSocket) by a session cookie.
- Two roles: `owner` (can toggle external access and mint invites for new identities) and `member` (can mint invites for their own additional devices). Both have full operational access once inside.
- Sessions are created when someone opens an invite URL — issued by an owner for a new identity, or by a member for one of their own devices.
- The first owner claims the office at `http://localhost:4000` on the host machine. Until that claim happens the server is only reachable from the host (or via an SSH tunnel).

## End-to-end flow

### 1. First boot — owner claim

On startup, the server checks `~/.bureau/users.json`. When no user has `role: "owner"`, the server listens on the loopback interface only (so the office isn't reachable from your LAN or VPN yet), serves a name-picker form at `/`, and prints a banner with the two ways to reach it:

```
================================================================
  Bureau: no owner has been set up for this office yet.

  TO CLAIM OWNERSHIP from THIS machine:
    Open http://localhost:4000 in your browser.

  TO CLAIM OWNERSHIP from another machine:
    1. On that machine, open a tunnel to this box:
         ssh -L 4000:localhost:4000 <user>@<host>
    2. Open http://localhost:4000 in that browser.

  After you claim, the Access pane lets you enable external
  access so everyday use doesn't need the SSH tunnel.
================================================================
```

Pick a display name on the form (the only flow where claimants name themselves, because there's no prior owner to have named them). Submit → cookie set → redirect to `/` → you're in.

If you don't get to it on the first boot, the same form is served on every subsequent boot until someone claims the office. The submit handler accepts only loopback peers and same-origin requests as defense-in-depth; the listener interface is the primary boundary.

### 2. Inviting members

Once you're the owner, open `User Settings` → `Access` pane:

- **Issue invite**: enter a display name, pick a role. Click `Issue invite`. The URL appears once — copy it. The URL is one-time per device and expires 24 hours after issuing if unused.
- **Outstanding invites**: every unclaimed invite is listed with its token prefix; revoke any from this table.
- **Active sessions**: every currently-signed-in device; revoke any to immediately disconnect them.

Send each URL to the invitee through whatever channel you trust (Signal, text, email). The invitee opens it on their device → cookie set → they're in. No installs, no accounts, no passwords.

An invite never changes a browser that is already signed in as a different user. The server refuses the acceptance without consuming the link or changing the cookie. Open the link in a private window or a different browser profile instead. A stale or revoked cookie does not block acceptance; it is replaced by the new session.

Owner-issued invite links expire 24h after issuing if unused; self-device links (generated via `mint_self_invite`) expire after 1h. Neither TTL is configurable: invite URLs are bearer tokens, and the shorter their acceptance window, the smaller the exposure if the URL ends up in the recipient's browser history, sync, or messaging archive. If the first link expires before the recipient can act, mint a fresh one. The session that's created on acceptance is governed by a separate, much longer lifetime (see Cookie semantics below).

### 3. Multi-device users

Inviting a user who already exists requires the `Issue an additional invite` confirmation in the form. The framing is "additional invite for that identity" — it does not revoke their existing sessions, does not mutate their role. One user can have many simultaneous sessions (laptop + phone + tablet).

### 4. Member self-invites

Members can add more of their own devices without involving the owner. In `User Settings`, the `My devices` pane (which replaces the `Access` pane for non-owner roles) has a single `Generate device link` button — no role/target/TTL knobs. Click it; the URL appears once. Copy it, open it on the other device, you're in as the same identity.

Self-device links are tighter than owner-issued invites by design: **1h TTL** and **at most one outstanding at a time** (generating a new one replaces the previous). The 1h window matches the legitimate flow ("both my devices are right here, click it now"). The role, target user, and TTL are all fixed server-side from the caller's session, so a tampered client can't extend the window, change the role, or mint for a different identity. The wire-level check rejects any such attempt.

The `My devices` pane also lists the member's outstanding invites and active sessions, scoped to themselves — same tables as the owner's `Access` pane, filtered to one identity.

Opening your own device or recovery link in a browser where you are already signed in is safe: the new session cookie has the same stable identity. Existing tabs and WebSocket connections remain that user, and a reload or reconnect uses the new same-user session.

### 5. User preferences

Each signed-in user can edit their own profile in `User Settings`, including
ghost appearance, notification rooms, personal agent context, env file path, and
language preference. The saved language follows the user across devices and is
used for agents they spawn plus browser speech input/output where supported.

### 6. Personal API tokens

Each signed-in user can create bearer tokens in `User Settings` -> `API tokens`
for scripts or off-device API calls. A token is shown once at creation, stored
only as a SHA-256 hash in `~/.bureau/api-tokens.json`, and can expire after 30
days, 1 year, or never. Revoking a token removes it immediately.

Use one as:

```
curl -s http://<office>/api/agents -H "Authorization: Bearer bureau_pat_..."
```

Personal tokens authenticate as the owning user for operational HTTP API routes,
including visible agents, rooms, tasks, apps, logs, cron jobs, editor and file
actions, memory, and office reads. They do not create browser sessions, cannot
accept invites, cannot mint durable access or revoke browser sessions, cannot
change user access or office settings, and cannot grant privileged-agent access.

Agents can reply to the token holder by posting to the token's inbox id:

```
curl -s -X POST http://<office>/api/api-token-inboxes/<token-id>/messages \
  -H "Authorization: Bearer <agent-token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reply-1" \
  -d '{"text":"The report is ready."}'
```

The token drains its conversation log with a cursored, non-destructive poll
(`after` defaults to `0`; pass the last seen `sequence` to advance). Both
API→agent sends and agent replies appear as sequenced entries under
`~/.bureau/token-logs/<token-id>.jsonl`:

```
curl -s -X POST http://<office>/api/me/api-token-inbox/drain \
  -H "Authorization: Bearer bureau_pat_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: drain-1" \
  -d '{"after":0}'
```

Mutating token routes accept an optional `Idempotency-Key` header (same key +
same body replays with `Idempotency-Replayed: true`; same key + different body
→ 409). Prefer that over `clientMessageId`, which API token senders cannot use.

### 7. Sign out

`User Settings` → `Sign out` revokes the current device's session and reloads. Other devices for the same user stay signed in. If you're the office's last active owner session, sign-out is refused with a lockout-prevention message — mint another owner invite first, accept it on a second device, then retry.

Do not sign out to accept an invite for a different user. A sole owner's last active session cannot sign out, and replacing it would lose the browser's reachable owner credential. Use a private window or a different browser profile for the invite.

## Reachability

Auth gates who can use the office once they reach it. Getting the box itself reachable from outside your home network is a separate problem.

### Recommended: Tailscale Funnel

Funnel exposes a single port on a Tailscale machine to the public internet over the box's existing `*.ts.net` hostname. Free, no domain to buy, no router port-forwarding, no inbound IP exposure. Tailscale's relay forwards an encrypted TCP tunnel between the visitor and your node; TLS terminates on your box, not at the relay, so the relay cannot read traffic in flight.

Trade-offs:

- **Dependency on Tailscale's relay and control plane.** Your reachability is contingent on Tailscale's infrastructure being up and on Tailscale not changing the free tier in adverse ways.
- **Public DNS visibility.** Your `*.ts.net` hostname (and therefore your tailnet name) becomes resolvable from the public internet and appears in Certificate Transparency logs once Tailscale provisions a Let's Encrypt cert.

To set this up, claim ownership of your office first (open the form on the host or via `ssh -L`), then run `tailscale funnel --bg http://localhost:4000` from the box. Funnel reports a public `https://<host>.ts.net` URL. Open `User Settings -> Access -> External access`, toggle it on, paste the URL into the **Public URL** field, click Save, then restart bureau so the new bind takes effect. For a user service, run `systemctl --user restart bureau`; for a system service, run `sudo systemctl restart bureau`. Sign in on the public URL using the invite link the Access pane shows you after Save.

### Alternative: Tailscale, tailnet-only (no public URL)

If you don't want a public URL at all, run bureau on your tailnet and only invite people who are willing to join. Tailscale Serve gives you HTTPS at `https://<host>.<your-tailnet>.ts.net`. After claiming, open the Access pane, enable _External access_, paste that URL into the Public URL field, save, and restart bureau.

Invite links still work over the tailnet, but invitees have to install Tailscale and join your tailnet first.

### Alternative: Caddy + your own DNS

No third-party hop in the data path. Open port 443 on your router, point a DNS A record at your home IP (or use DDNS), run Caddy in front of bureau with `reverse_proxy localhost:4000` (Caddy auto-provisions a Let's Encrypt cert), then enable _External access_ in the Access pane with your `https://` URL and restart. Trade-offs: your home IP is publicly visible, you carry any DDoS surface, and the path fails if your ISP puts you behind CG-NAT.

Cloudflare Tunnel is another outbound-tunnel option (same shape as Funnel using Cloudflare's edge; requires a domain on a Cloudflare-managed zone).

## External access and public origin

Post-claim, the **Access pane** in User Settings has an _External access_ section with:

- **Office name** text field (optional, ≤ 64 chars). Prefixed onto the sign-in / claim / invite-accept page titles as `<Office name> | Bureau — sign in`. Useful when you run multiple bureau instances and want to tell them apart at a glance. Takes effect on the next page render — no restart needed.
- **Enable external access** toggle. Off by default; the server keeps binding `127.0.0.1` only and the office is reachable from the host machine (or via an SSH tunnel) but not from your LAN/VPN.
- **Public URL** text field. Where browsers on other machines will reach this office (e.g. `https://my-mac-mini.<your-tailnet>.ts.net`).

Saving persists all three fields to `~/.bureau/office-config.json` and (when external access is on) mints an owner self-invite bound to the new URL so you can sign in on the new origin immediately. The toggle takes effect on the next bureau restart (the pane spells out `systemctl --user restart bureau` for a user service and `sudo systemctl restart bureau` for a system service). Restart is intentional: changing the bind interface and cookie/origin policy mid-process is brittle, and the toggle is rare enough that "save then restart" is the right trade.

The resolved value drives:

- The bind interface (`0.0.0.0` when external access is on; `127.0.0.1` otherwise).
- The Origin allowlist for WebSocket upgrades.
- The Origin allowlist for state-changing HTTP requests.
- Whether the session cookie's `Secure` attribute is set (set on `https://`, omitted on `http://localhost`).
- The base URL for invite URLs.

The Public URL is **operator-authored configuration**. The server never infers the origin from `Host` or `X-Forwarded-Host` headers, since that's how WebSocket-hijacking bugs happen. An invalid value in `office-config.json` is logged and ignored at boot; the server degrades to the localhost fallback.

A deprecated `BUREAU_PUBLIC_ORIGIN` environment variable is still recognized for one release as a migration hatch. At boot, if the env var is set and `office-config.json#publicOrigin` is empty, the env value is migrated into the JSON and a deprecation note is logged. The env var continues to win for that boot via the precedence chain (env > JSON > localhost fallback), but the recommendation is to remove it once the JSON value is saved. A future release will drop the env path entirely.

## State files

Stored in `~/.bureau/`:

- `users.json` — boss profiles. Each record carries `role: "owner" | "member"`.
- `invites.json` — outstanding invites, keyed by sha256(token). Raw tokens never persist; only the hash and an 8-char display prefix.
- `sessions.json` — active sessions, keyed by sha256(session-id). Raw IDs never persist.
- `api-tokens.json` — personal API tokens, keyed by generated token ID and storing only SHA-256 hashes plus display metadata (`lastSequence`, `lastDrainedAt`). Conversation rows live in `token-logs/<id>.jsonl`.
- `admin.sock` — Unix-domain socket for owner-login recovery. It answers only root or `BUREAU_RECOVERY_UID`, never the Bureau server UID.

All three JSON files are written atomically (temp + rename) and serialized under a single in-process mutex so invite acceptance (which touches all three) can't race.

## Cookie semantics

- Name: `__Host-bureau_session`, or `bureau_session` on `http://localhost*`, which cannot carry the `Secure` the prefix requires. The prefix is browser-enforced to be host-only, so a page on a subdomain of the office host cannot write the cookie the office reads. Both names are accepted (the prefixed one wins by presence); an existing session moves onto the prefixed name on its next page load or WebSocket connection, and the legacy cookie is cleared only after the new one is seen coming back — no deployment shape logs anyone out. Sign-out clears both names.
- Attributes: `HttpOnly; Path=/; SameSite=Lax`
- `Secure` set when the configured Public URL is `https://`, omitted when the server is on `http://localhost*` (pre-claim, or post-claim with external access off).
- Rolling expiry: 30 days, refreshed on activity.
- Absolute cap: 1 year from creation.

The 1-year cap is a deliberate usability/security trade-off. The cookie carries `HttpOnly`, `SameSite=Lax`, `Secure`-on-HTTPS, host-only scope, and a per-message server-side recheck so a revoke from the Access pane disconnects an active session within ~1s — the residual risk is the shared-device case where the user forgot to sign out. Devices used in untrusted environments should be revoked from the Access pane (or signed out explicitly) rather than relying on session expiry.

## Trust model boundaries

- **Inside the office, authenticated users have shell-equivalent access.** Members can use the terminal panel to read any file the bureau process can read, including other users' env files. The owner/member split controls who **expands the trust boundary** (mints invites, revokes sessions), not what they can do once inside.
- **Agents run with the host Linux user's permissions.** The cookie auth doesn't constrain what an agent does once it's spawned in the office.
- **Session revocation stops future use of a session but doesn't undo past actions.** Anything the leaked session already wrote stays written.

## Use your own provider account

Set your Env file path in User Settings to a file with API keys:

```text
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

For subscription billing, create a separate config directory and sign in once:

```bash
mkdir -p ~/.bureau-users/<user>/.claude
CLAUDE_CONFIG_DIR=~/.bureau-users/<user>/.claude claude auth login

mkdir -p ~/.bureau-users/<user>/.codex
CODEX_HOME=~/.bureau-users/<user>/.codex ~/.bureau/bin/codex login --device-auth
```

Then put the config directory in the env file with an absolute path. Bureau does not expand `~` or `$VAR` there.

```text
CLAUDE_CONFIG_DIR=/home/<linux-user>/.bureau-users/<user>/.claude
CODEX_HOME=/home/<linux-user>/.bureau-users/<user>/.codex
```

### Claude on Amazon Bedrock

Set these variables in the Env file that applies to the agents:

```text
CLAUDE_CODE_USE_BEDROCK=1
AWS_REGION=us-west-2
AWS_BEARER_TOKEN_BEDROCK=ABSK...
```

The bearer token is a Bedrock API key from the AWS console (Bedrock → API keys). If you use an IAM access key instead, replace that line with `AWS_ACCESS_KEY_ID=AKIA...` and `AWS_SECRET_ACCESS_KEY=...`, plus `AWS_SESSION_TOKEN=...` if the credentials are temporary.

Then `/clear` Claude agents to pick up the variables.

Model pins are optional: with none, the picker’s `opus` is Opus 5.5 and `sonnet` is Sonnet 4.5 on Bedrock. To change a default, set the family’s pin to a Bedrock model or inference-profile ID, for example `ANTHROPIC_DEFAULT_SONNET_MODEL=us.anthropic.claude-sonnet-4-6`; the others are `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL` and `ANTHROPIC_DEFAULT_FABLE_MODEL`. Conversation titles use the Sonnet default. `ANTHROPIC_MODEL` does not override the picker. Agents pick the variables up on their next new or resumed conversation.

Connections shows Bedrock as connected when the variables are set; it does not check AWS model access. A user who wants their own Claude login in a Bedrock office sets `CLAUDE_CODE_USE_BEDROCK=0` in their own Env file. Vertex works the same way with `CLAUDE_CODE_USE_VERTEX`.

Provider status probes on Connections are time-bounded (~15s). A timed-out check reports unavailable but still offers host CLI guidance, and is not written into the status cache. Bureau does not yet run shared browser/device OAuth login; instead a process-local per-provider "sign-in in progress" slot (Claim via **I'm signing in on the host**) surfaces the holder's name and start time to other members until they finish or an owner cancels. Slots expire after ten minutes and vanish on process restart.

## Bootstrap-window exposure

Before an owner exists, the first-owner form is served only on `127.0.0.1`, so the OS bind rules out off-box clients regardless of LAN/VPN topology — Bureau is not reachable to an outside attacker.

A same-host reverse proxy or tunnel (Tailscale Funnel, Caddy → localhost, etc.) configured **before** an owner claims can forward external traffic to `localhost:4000`, which arrives from a loopback peer. Bureau treats a loopback request as local only when it carries no forwarding header (`X-Forwarded-For`, `Forwarded`, `X-Real-IP`, …). Caddy and Tailscale add one, so the claim refuses their relayed requests and the agent-API loopback bypass doesn't apply to them. The residual gap is a same-host proxy that adds no forwarding header at all, which Bureau can't tell apart from a local process.

The mitigation is operator discipline: **claim first, expose later**. The Access pane's _External access_ toggle is the supported sequence — boot the server, open it locally (or via `ssh -L`), claim, then flip the toggle to enable external listening and configure the proxy.

## Locked out as owner

If you somehow lose your only owner session (cleared cookies, hit the 1-year absolute cap, etc.), recover with the owner-login CLI from a shell on the box:

```
bun run server/index.ts owner-login --name "<your-display-name>"
```

That prints a `sudo curl --unix-socket ...` command. Run it on the host to print a one-time login URL valid for 15 minutes. The server has to be running for the command to work. The admin socket checks the connecting peer UID and answers only root or `BUREAU_RECOVERY_UID`; it refuses the Bureau server UID because agents, terminal panels, and generated apps commonly share it.

## Operating notes

- **Members lose access at server restart? No.** Sessions persist to disk; restarts pick up the in-memory map from `sessions.json`.
- **Revoking a live session?** The Access pane revoke button: the corresponding WebSocket force-closes within ~1s (per-message session recheck catches it). HTTP requests with the revoked cookie return 401 immediately.
- **Member tries to mint an invite for a new user?** Rejected at the wire level. Members can mint self-invites for their own additional devices (1h TTL, max 1 active) but can't invite new identities. The Access pane is scoped per role; the server-side check is the actual gate.
- **CSRF / CSWSH?** Origin is checked on WS upgrade and on state-changing HTTP methods. Browsers always send Origin; non-browser callers (agents on the same host) don't, and are allowed via the loopback bypass for the agent-API paths only.
