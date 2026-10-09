# Agent-built apps

An **app** is a web app an agent built and handed to Bureau to run. Bureau
allocates its address, supervises its process, gives it an identity of its own,
and shows it to the boss in the Apps tab.

Like a cronjob it is something Bureau runs that is not an agent. Unlike a
cronjob it **outlives the agent that made it**, because it belongs to the
_user_: an agent is a working session, and an app is a thing the boss keeps
using.

## Why it exists

Before apps, an agent asked to "build me a habit tracker" had to pick a port
and hope nothing else wanted it, then hand-roll backgrounding that died with
its session. The system prompt's advice was literally "pick an uncommon port
and keep it". Bureau now owns the port, the process, and the address.

## The shape

Five areas, with one job each:

| Module                          | Owns                                               | Persists                                  |
| ------------------------------- | -------------------------------------------------- | ----------------------------------------- |
| `server/apps/registry.ts`       | names, ports, data dirs, the hostname-label ledger | `~/.bureau/apps/apps.json`                |
| `server/apps/supervisor.ts`     | the systemd unit that runs the app                 | nothing                                   |
| `server/apps/tokens.ts`         | the app's own credential                           | `~/.bureau/apps/app-tokens.json` (hashes) |
| `server/apps/message-limits.ts` | what an app may spend on waking its agent          | nothing (in-memory)                       |
| `server/apps/host/`             | serving apps at their own hostnames (below)        | nothing                                   |

The registry runs nothing; the supervisor persists nothing. That split is what
lets an app's state be _derived_ at read time rather than stored — a persisted
"running" is a lie the moment the box reboots.

## Whole-life addressing

**A name and a port belong to one app for as long as that app exists**, and no
verb rewrites either. Both outlive Bureau's reach the moment somebody bookmarks
the address, so moving a live app's address is the failure the registry exists
to prevent. A mistyped command is fixed with `PATCH`, never by deleting and
re-registering.

Deleting an app frees its name and port for reuse. What is **never** freed is
its _hostname label_: the ledger in `apps.json` records every label ever
issued, so a reused name lands on a fresh generation (`hello`, then `hello-g2`)
and can never be served at the previous app's origin — which is where a browser
still keeps that app's service worker, caches, and storage.

Two consequences that read as over-caution until you connect them to that
invariant:

1. **Corruption fails loud, never empty.** A malformed `apps.json` raises
   `registry_corrupt` and nothing proceeds — including reads. The tempting
   alternative (treat it as empty, the way tasks and cronjobs do) would
   duplicate a live registration, hand a second app a port that is already
   serving, and then persist the truncated view over the file that held the
   truth. A cronjob can afford a lost row; this cannot.
2. **Persistence failures propagate.** Every write throws and the route answers
   500, rather than reporting a registration that was never written.

## Commit order

The registry and the supervisor are touched in opposite orders by the two verbs
that matter, and neither order is arbitrary:

- **Register** commits to the registry _first_, and a failed install does not
  undo it. An app whose unit did not install is a registered app that
  `start`/`PATCH` can still fix, so the answer is `201` plus `startError` — a
  500 would invite a retry that can only ever be told the name is taken.
- **Delete** tears the unit down _first_. Removing the record frees the name and
  port, and doing that while the process is still alive leaves it holding a port
  under a name the registry has forgotten. A failed teardown therefore keeps the
  record, so a retried `DELETE` can finish the job.

The same rule covers the token: it is provisioned _before_ the first install (a
process's environment is fixed at exec, so an app started before its token file
existed would run tokenless), and revoked _between_ the teardown and the record
removal (the app is provably down, and the record is still there for a retry).

## Running the app

The supervisor is the one place Bureau touches systemd, and two mechanisms make
its isolation structural rather than merely likely:

- **One seam.** Every `systemctl` call, `journalctl` call, and unit-file write
  goes through an injectable host. A test injects a fake and is then incapable
  of reaching the machine, rather than trusted not to.
- **The unit namespace follows the state root.** `bureau-app-<name>` belongs to
  the office on the default `~/.bureau`; any other `BUREAU_HOME` gets its own
  hashed prefix. Two offices on one box hold two different `apps.json`, and
  sharing a unit namespace would mean one office's delete stops the other's app.

**The start command never appears in `ExecStart`.** It is a free-form shell
string an agent typed, and systemd does its own unquoting and `%` expansion, so
interpolating it would mean escaping through systemd's parser — where a mistake
silently mangles the command instead of failing. Bureau writes it byte for byte
into a launcher script it owns and names only that script.

The launcher lives beside the registry state, **not** in the app's data
directory: the app writes to its data directory, and a program that can rewrite
its own launcher can change what Bureau starts as it on the next boot. The
token's environment file sits there for the same reason.

Resource limits (512M memory, 100% CPU) and a start limit of five attempts per
minute are set explicitly, so a broken app comes to rest in `failed` — where its
state says so and `restart` can pick it back up — instead of looping forever and
filling the journal.

## The app's own identity

Each app gets a token, held as a hash by Bureau with the plaintext in an
environment file its unit reads. The pair is worthless split in half, so
provisioning writes both or neither.

That token reaches **exactly one route**: `POST /api/app/message`, which drops a
message into the chat of the agent that built the app. Nothing about the message
is the caller's to choose except the text — which app is speaking comes from the
token, who hears it comes from the registry, and the label comes from the app's
registered name. So the path carries no app name and the body carries no
recipient: neither is a field anyone can lie in. Apps never _steer_; an app must
not be able to interrupt a turn in progress.

Two limits with different meanings:

- a **burst slot** (10/min) is spent by any syntactically valid request, so
  hammering a request that always fails is not free;
- the **daily budget** (500) stands for model spend, and moves only on a
  delivery the receiver accepted.

Deleting an app forgets its budget, so the next app to take the name — which may
belong to a different user — does not inherit what the last one spent.

## Boot reconciliation

Three facts about a token live in three places: the hash, the plaintext, and
whether the installed unit actually references the file. None can be checked
from a request path without a subprocess per app, so `server/apps/boot.ts` runs
one pass at startup. It repairs apps registered before app tokens existed, and
those whose provisioning half-happened because Bureau died between the two
writes. It regenerates files without activating anything, and a corrupt registry
aborts the pass rather than the boot — an office should not fail to start over a
subsystem it may not even use.

## The HTTP surface

| Route                                       | Who calls it                           |
| ------------------------------------------- | -------------------------------------- |
| `GET /api/apps`                             | the boss's browser, or an agent        |
| `GET /api/apps/:name`                       | "                                      |
| `POST /api/apps`                            | an agent registering what it built     |
| `PATCH /api/apps/:name`                     | fix command, cwd, or description       |
| `DELETE /api/apps/:name`                    | stop it and free the name              |
| `POST /api/apps/:name/{start,stop,restart}` | recovery verbs                         |
| `GET /api/apps/:name/logs?lines=N`          | the journal tail                       |
| `POST /api/app/message`                     | **the app itself**, with its own token |

Ownership comes from the caller's identity, never the body: an app belongs to
the registering agent's _manager_. Office owners see every app; members see the
apps their user owns, plus launch-only rows for apps whose live creator agent is
in a room they can access; a loopback shell caller sees everything and owns
nothing. Logs, command, working directory, and lifecycle controls stay limited
to app owners and office owners.

Environment variables an app receives: `PORT`, `BUREAU_APP_NAME`,
`BUREAU_APP_DATA_DIR`, `BUREAU_APP_TOKEN`, and — only where the office has app
hostnames — `BUREAU_APP_URL` and `BUREAU_APP_HOST=127.0.0.1`.

## The app-host arm

Serving apps at their own hostnames, so an app called `hello` on an office at
`office.example` answers at `hello.office.example`. **Inert unless the office
has an HTTPS public origin at a real DNS name with a wildcard record pointed at
it.** Every plain-HTTP office, every dev box, and every Tailscale-only office
has no app-host domain at all and behaves byte-identically to an office without
this code.

`server/apps/domain.ts` derives the domain from the office's public origin and
nothing else — no config key, no override. Three refusals, each for its own
reason: loopback names, a `.localhost` suffix, and address literals cannot carry
children; a single-label host has nothing to hang them off; and a Tailscale
MagicDNS office deliberately keeps port links, because MagicDNS has no wildcard
records and a Tailscale certificate covers the node's own name only, so deriving
a domain there would hand every app an address that resolves nowhere and then
write it into the app's environment. The domain is frozen once at boot, and
reading it before the freeze throws rather than resolving to a different answer
than the rest of the boot will see.

An app's URL uses its issued **label**, never its reusable name, so a recycled
name is never served where a retired app's origin was. Because the address
derives from the office rather than the app, an office that gains or loses a
domain leaves every unit stale — `server/apps/url-reconcile.ts` converges them
at boot, restarting only what was actually running and rolling a unit back if it
cannot finish.

**Containment is the security property.** `server/apps/host/match.ts` decides,
before any route runs, whether a request is for the office (fall through,
unchanged) or a strict child (diverted, and no office handler ever sees it). App
hostnames sit under a wildcard, so anyone can point any name under it at this
server, and none of those names may reach the office's own surface. The office's
own host can never match a child test, so there is no exemption for it — worth
knowing before anyone adds one back assuming it is load-bearing.

**The handshake** (`server/apps/host/auth*.ts`) is how a browser holding an
office session comes to hold one for an app. An app origin must never be handed
the credential that opens the office, so the two are separate cookies: the app
host bounces a navigation to the office, the office mints a single-use code
against the caller's revalidated session, and the app host redeems it for a
`__Host-bureau_app` cookie bound to that app's label _and generation_ — so a
cookie for a retired app cannot open its successor at the same name. Only a
request that could actually finish the flow is sent into it, and every refusal
is the same neutral 404 an unknown label gets, so no surface here is an oracle
for whether an app exists or who owns it.

Who may reach an app is the rule the `/api/apps` routes already apply to which
apps a caller may _see_: office owners reach every app, app owners reach their
own apps, and members sharing the live creator agent's room can launch the app
without gaining management access. An app a member cannot see in the Apps tab
should not be one they can open by typing its hostname, and a hostname is
guessable in a way an API listing is not. The permit is re-asked on every
request, so a room grant, demotion, creator move, or creator kill changes app
reachability without waiting for a cookie to expire.

**Certificates** (`server/apps/tls-ask.ts`) are gated for a terminator that
terminates TLS on demand under the wildcard. The endpoint is a live _access_
gate, not an issuance hook: upstream measurement shows a terminator asks it
before loading a certificate it already holds, so every live name is re-asked in
a burst after a terminator restart, and a refusal then would refuse a handshake
for which a valid certificate exists. So an admitted label is free forever, and
that fact lives in the registry's ledger to survive a restart of the office too.
New admissions are capped (ten an hour, the registry's accounting), and every
refusal reached before the admission attempt touches no state — a stranger
pointing names at the box cannot spend the budget or cause a write.

Bureau ships no terminator of its own; this endpoint exists for a deployment
that puts one in front of the office.

**The relays** carry an authenticated request to the app's own loopback port and
its bytes back, for HTTP (`host/proxy.ts`) and WebSocket (`host/ws-*.ts`). A
relay is where two parties' assumptions meet, so most of that code is about not
passing something along: the app never sees the cookie that admits to it nor
either office session cookie, never a client's `X-Forwarded-*` (the relay owns
those, and a header the relay owns is worthless if a client can pre-fill it),
and the browser never sees the app's hop-by-hop headers or a `Content-Encoding`
describing bytes Bun already decoded. **Nothing at all is sent to an app that is
not running** — a stopped app's port is just a free port, and any local process
could be sitting on it — checked before a permit and before a socket, through the
injected supervisor rather than the production singleton.

For WebSocket the relay decides what the app cannot: the Origin check happens
before anything dials, and a subprotocol is matched exactly or the upgrade is
refused, with the app's own pick riding the 101 rather than a guess at the first
offer. Close codes are carried honestly both ways — a code a peer may not send
is replaced, a dropped transport becomes 1006 rather than a clean close nobody
performed.

`host/dispatch.ts` is the only entrance, and it runs before the URL is parsed.
The order of its checks is the argument: an unknown label, a retired one, and a
name too deep to be an app are all the same neutral 404; the reserved namespace
is checked ahead of the WebSocket branch, because an upgrade is a GET and the
handshake path answers GETs, so the other order would let an upgrade at the auth
path redeem a code and then be relayed; and an upgrade is answered here rather
than falling through, since falling through would hand a diverted host to the
office's own `/ws`.

## Not here yet

Nothing in the arm itself. Two limits worth knowing: an app is reachable only by
its owner and by office owners (see the divergence above), and pointing a second
app at a different agent is not supported — an app messages the agent that
registered it or nobody.

On the deployment side, Bureau ships no TLS terminator and no installer, so
putting one in front of the office — a wildcard record, a site block that
terminates on demand, and the certificate gate wired to it — is an operator
task. Everything below that line is inert until then, which is the intended
resting state for a laptop office.

## Thumbnails and archive

App owners and office owners can upload a PNG thumbnail from the app card. The
upload is limited to 1 MiB and dimensions of 1–4096 pixels per side. The image
replaces the live preview, can be removed, and is served only to viewers who can
see the app. Media is tied to the app's generation, so deleting and reusing a name
does not inherit an old image.

An authenticated agent with management access can also `PUT` JSON
`{"path":"screenshot.png"}` to `/api/apps/:name/thumbnail` with
`Content-Type: application/json`. Relative paths resolve against that agent’s
working directory, using the same path resolver as its file editor. The file
must be a readable regular PNG within the same size and dimension limits;
credential paths, directories, and special files are refused. The JSON body is
limited to 8 KiB. Browser and personal API-token callers use the binary upload
form; the JSON form requires an agent token.

**Archive** stops and tears down the runtime, revokes its token, and hides the
app from the active list and hosted routes. It preserves the record, thumbnail,
name, port reservation and data directory. Toggle **Archived** in Apps to view
or restore it. **Restore** retains the same identity and data, provisions a fresh
runtime token and installs the runtime. A failed runtime install is reported on
the restored card so it can be retried. Failed teardown does not mark an app
archived. Archived apps stay stopped after a server restart.

The API adds `POST /api/apps/:name/archive`, `POST /api/apps/:name/restore`, and
`GET /api/apps?includeArchived=true`. `GET`, `PUT` and `DELETE` on
`/api/apps/:name/thumbnail` read, replace and remove the PNG. Deletion still
retires app data under `.retired` and removes the thumbnail; archive is reversible
without deleting that registration.
