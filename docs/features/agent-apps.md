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

Four modules, with one job each:

| Module                          | Owns                                               | Persists                                  |
| ------------------------------- | -------------------------------------------------- | ----------------------------------------- |
| `server/apps/registry.ts`       | names, ports, data dirs, the hostname-label ledger | `~/.bureau/apps/apps.json`                |
| `server/apps/supervisor.ts`     | the systemd unit that runs the app                 | nothing                                   |
| `server/apps/tokens.ts`         | the app's own credential                           | `~/.bureau/apps/app-tokens.json` (hashes) |
| `server/apps/message-limits.ts` | what an app may spend on waking its agent          | nothing (in-memory)                       |

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
apps their user owns; a loopback shell caller sees everything and owns nothing.

Environment variables an app receives: `PORT`, `BUREAU_APP_NAME`,
`BUREAU_APP_DATA_DIR`, and `BUREAU_APP_TOKEN`.

## Not here yet

The **app-host arm**: serving apps at their own hostnames (`hello.example.com`)
through Bureau, with an HTTP and WebSocket relay, an auth handshake, and
on-demand TLS. The data model it needs is already in place — the hostname-label
ledger, the generation labels, and the certificate-admission gate all ship with
the registry — but nothing consumes them yet, and `AppWire.url` is always
absent. Until then an app is reached at `http://<box-hostname>:<port>`, or
through an SSH tunnel when only the office port is exposed.
