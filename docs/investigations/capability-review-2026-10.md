# October capability review

This review compares operator-visible behavior against Bureau's existing
architecture, documentation, and tests. It does not propose changing Bureau's
self-hosted product scope.

## Implemented gaps

| Capability | Result |
| --- | --- |
| Durable incident history | Resolved pages remain on disk and in the Pager view instead of disappearing after 30 days. Delivery still stops when acknowledged or resolved. |
| On-demand jobs | Schedules accepts `schedule: { type: "manual" }` through the form, REST, and WebSocket paths. `nextFireAt` is null, including after reload; Run now remains available. |
| Consistent room lists | User Settings orders rooms by the viewer's tabs, followed by other accessible rooms in office order. Editing another member does not substitute that member's ordering. |

Regression coverage checks pager reloads after a year, recurring/manual cadence
changes, stale timer timestamps, explicit run recording, schedule form rendering,
and room ordering with hidden, unavailable, and duplicate entries.

## Already covered

- Persistent agents, multiple providers, scoped memory, inter-agent messages,
  delayed messages, task boards, team chat, and privileged office management.
- Conversation branching, attachments, speech, terminal/editor/diff tools,
  browser previews, context readings, and subscription allowance indicators.
- Queue-preserving handoffs and Claude steering at tool boundaries.
- Queued permission requests, including advancing to the next approval.
- Owner revocation of member API tokens and token-log secret masking.
- Agent-spawned coworkers use unattended permission modes.
- App process supervision, authenticated hostnames, and preserving app data in
  `.retired` on deletion.
- Pager delivery, per-member settings, and backup exclusion of Discord secrets.

## Larger integrations implemented

| Capability | Result and boundary |
| --- | --- |
| Signed inbound webhooks | Raw-body HMAC, bounded ingress, durable replay claims, separate signing secrets, delivery records, dispatch authorization, dry runs and management UI. |
| Room-scoped schedules | Legacy migration, immutable run room snapshots, scoped REST/WS reads and events, usage and prompt discovery; creator/owner mutations. |
| Browser tab sharing | Packaged Chrome extension with single-use pairing, selected-agent grants, expiry, revocation, restricted actions, and cancellation on disconnect or cross-origin navigation. |
| App thumbnails and archive | Ownership-checked bounded PNG uploads, identity-scoped media, reversible archive, runtime teardown and credential rotation on restore. |
| Personal room controls | Personal drag ordering, tuck/reveal controls, same-user socket updates, optimistic rollback and current permission rebinding. |

## Outside Bureau's current scope

Managed hosting/billing, unattended VPS provisioning, deployment-specific
one-click updates, public-origin browsing, and a separate command-line product
remain outside the existing architecture decisions. Cosmetic theme defaults and
branding changes are product choices rather than missing capabilities.

## Operational limits

Pager history is retained in per-entry disk archives, while the active JSON
store holds unresolved entries. Queries scan archive files with bounded memory
and return access-filtered cursor pages. Scan time still grows with the archive;
this is not an indexed database. Legacy resolved rows migrate on load. Pages
deleted by previous versions cannot be recovered without a backup.

On-demand jobs use the existing manual-run authorization and lifecycle. The
enabled toggle controls timed runs; explicit Run now remains available even
when paused, matching recurring jobs. Signed webhook deliveries use the same run lifecycle without changing the timer cadence.

## Follow-up review — 2026-10-09

The five larger integrations above are implemented. This follow-up checked
recent release notes, the release comparison range, implementation, docs and
tests against the destination's current behavior. Changes were validated with
the normal CI gate; browser uploads also passed the real Chrome debugger harness.

| Capability | Shipped follow-up |
| --- | --- |
| API and backups | Unknown API paths return JSON 404; container app tokens stay out of backups. |
| Claude models | Haiku 5.5 and effort forwarding; environment-aware cloud capabilities; unsupported Auto falls back to Default without broadening permissions. |
| Provider sign-in | Environment tokens and macOS Keychain probes; bounded explicit Codex sign-out preflight, retained queued work and manual retry; bundled Claude login commands preserve the credential directory. |
| Browser replay | Lazy history replay with bounded live-event backlog, ordered history/live delivery, drain handling and access-change invalidation. Any incoming frame confirms heartbeat liveness. |
| Pager | Resolved entries move to retained disk archives; access-filtered cursor pagination, old-entry links, crash reconciliation and serialized delivery. |
| Apps | Agents can upload bounded PNG thumbnails by local file path. |
| Shared tabs | Selected agents can upload a non-sensitive regular file up to 1 MiB into a same-origin file input. |
| OpenCode | Bounded HTTP/SSE waits; no automatic prompt replay; active peers prevent process replacement; shared catalog loads, effort fallback notices and discovered context limits. |
| OpenCode office access | Office bearer tokens stay out of the shared child. Desk agents and schedules bind their own active-turn authority. The broker supports current reference, browser, Pager and app APIs and preserves binary thumbnails. |
| Room entry context | Apps, Schedules and Pager initially filter to the room they were opened from. |

### Covered or intentionally different

- Team chat starts closed unless explicitly opened, deep-linked or restored from
  the user's saved view; there is no empty initial chat overlay to minimize.
- Session resume reads current model/effort settings rather than a stale engine
  stamp. Existing tests cover settings and resume behavior.
- Codex does not emit a safety-hook artifact (`capabilities.hooks` is false), so
  concurrent artifact-write changes do not map to a destination behavior.
- Browser grants remain explicit for selected agents and one offered origin.
  All-agent grants and implicit popup access would broaden that boundary.
- Update entry controls already depend on `updateAvailable`; deployment-specific
  update workers and hosted account/billing flows remain outside this product.
- Recurring scheduled work already uses Schedules. A second recurring-message
  subsystem, a bundled browser, public-origin host previews and provider-device
  OAuth remain outside the accepted changes recorded in the earlier review.

### Implemented: OpenCode environment profiles

The remaining profile work was completed in the continuation pass. New sessions
use stable manager/room stores; durable bindings preserve resume, fork and
history access after restarts. Credential changes restart only between turns.
Legacy sessions retain their original store without copying shared data. See
[OpenCode environments](../features/opencode-environments.md) for the explicit
legacy boundary and profile-scoped login instructions.

## Follow-up review — 2026-10-10

Reviewed the latest release notes and comparison range, current implementation,
and nearby tests against Bureau's existing capabilities. The release review is
recorded separately from deployment certification; passing app CI does not
establish that a hosting platform permits nested sandboxes.

| Classification | Capability and result |
| --- | --- |
| Implemented | Task status and priority checkbox filters, counts respecting the opposite filter group, and a retained/reopenable Obsolete state. Active counts exclude completed and obsolete tasks. |
| Implemented | Single-dispatch browser pointer clicks, native select actions by value or label, and explicit first-dialog acceptance with recorded outcomes. Shared tabs retain origin and selected-agent restrictions. |
| Implemented | Bun 1.4.2 in Flox on Linux/Apple Silicon and in the Render image. Intel macOS retains 1.3.13 pending catalog availability. |
| Implemented | Cloud model labels and manifests reflect launch-time alias targets/custom pins and effective permissions without overwriting saved preferences. |
| Implemented | Render includes bubblewrap. Codex stderr retains namespace diagnostics, including failures coalesced with informational startup notices. |
| Implemented | Corrected the Render entrypoint's stale authentication import, found by a fresh-container startup check, and added a production-import build test. |
| Already covered | Render's setup key is origin-checked and accepted only before owner creation; existing tests cover invalid keys, foreign origins and replay after claim. |
| Already covered | Browser checks use a real Chrome harness, and app relay tests exercise socket closure and resource cleanup under the pinned runtime. No blanket quarantine was added. |
| Not destination-native | Automatically changing a restricted Codex sandbox to full access after a failed host probe. Bureau retains the selected mode and reports errors. |
| Not destination-native | Hosted signup, billing database privileges, Caddy installer changes, deployment-specific release gates and safety-hook artifact tests for a backend that does not expose hooks. |

### Implemented: skills management

The dedicated `/skills` page supports browse, create, edit and delete for
owner-managed personal/project prompts in Claude and Codex agent contexts.
Packaged/plugin content is read-only; members can browse their own agents.
Aliases appear once and built-in commands have a separate tab. Versioned atomic
writes, opaque handles, bounded text and symlink guards protect the editor API;
deletion preserves adjacent assets. See [Skills library](../features/skills-library.md).

### Implemented: fresh-install matrix

The Fresh install workflow now exercises local Linux/macOS, private/Funnel/domain/
VPS origin configurations, the Render deployment image and a disposable Kubernetes
cluster using the production security context. Each case claims an owner, runs a
real PTY command and checks signed-out Claude/Codex guidance. No provider account
or paid hosting service is required. The first runs found and fixed the packaged
macOS PTY helper's missing execute bit; Flox now supplies Node 24 for the sidecar.

See [Fresh-install verification](../contributing/fresh-install-matrix.md) for the
commands and explicit boundaries: remote service provisioning, public TLS and
cloud storage certification remain environment-specific operational checks.

All three continuation gaps are implemented: OpenCode profiles, the skills
library and the fresh-install matrix. Earlier product-scope exclusions remain
unchanged; no actionable gap from this review is deferred for size.

## Follow-up review — 2026-10-11

Compared the October 10 release notes and comparison range with the current
default-branch implementation, docs and tests. All actionable gaps in this
review are implemented; the existing product-scope exclusions still apply.

| Classification | Capability and result |
| --- | --- |
| Implemented | App short links redirect to authenticated app hostnames, preserve queries and avoid reserved office paths. Agent handoffs preserve ownership and app data while rebinding room visibility. |
| Implemented | Regional Claude cloud defaults select supported Sonnet/Haiku profiles without replacing explicit pins or routing unknown regions through a global fallback. |
| Implemented | Privileged agents can edit versioned member instructions through a narrow endpoint. Concurrent edits preserve the local draft and surface the current text; role and access changes remain unavailable. |
| Implemented | Per-task atomic records retain actor-attributed changes, deletion tombstones and owner restoration. Legacy task storage remains readable; history respects both sides of room changes. |
| Implemented | Owner-only office audit records capture mutation metadata and pending/committed/failed persistence outcomes. Flat files preserve Bureau's no-database architecture; secrets and request bodies are excluded. |
| Implemented | A transient shared-tab target closure gets one bounded recovery attempt for the same page and origin. Interrupted input is never replayed; revocation, expiry, changed targets and repeated detachments end sharing. |
| Implemented | Member usage settings retain a visible loading frame and show an explicit load failure. |
| Already covered | Interactive terminal behavior and provider login commands have real PTY coverage across the fresh-install matrix. Replacing the PTY implementation is unnecessary for that capability and would disrupt the retained Intel macOS runtime boundary. |
| Not destination-native | Hosted provisioning, billing governance, deployment logging and platform-specific smoke infrastructure remain outside the self-hosted product scope. |
| Not an implemented capability | An app-chat widget design document does not establish a working feature to port. |

Validation includes the normal CI gate, authorization and stale-write tests,
task reload/failure/restore tests, audit concurrency and secret-omission tests,
and a real Chrome debugger detach/reattach exercise. Browser interruption tests
verify that a late protocol response cannot send input after invalidation.
The Chrome harness simulates the debugger detachment; it does not launch a
native application on the operator's desktop.

Task history and audit records consume retained disk space and use file scans,
not indexed queries. See [task storage](../features/task-system-design.md),
[office audit](../features/office-audit.md) and
[browser sharing](../features/browser-sharing.md) for migration and failure
boundaries.

## Follow-up review — 2026-10-13

Reviewed the October 11 release and its comparison range, then default-branch
changes through October 13, including implementation, tests and design documents.
The app-chat proposal has now become an implemented capability; this review
supersedes its earlier design-only classification.

| Classification | Capability and result |
| --- | --- |
| Implemented | App short URLs now open an authenticated app/chat view with a sandboxed app iframe, existing agent chat, mobile switching, drafts scoped to user/app generation/agent, session renewal and access revocation. |
| Implemented | Session replacement closes a prepared replacement when its agent is removed during consumer drain; it cannot resurrect the removed agent. |
| Implemented | OpenCode startup uses an OS-selected port and a bounded 60-second health window. Errors, retry notices and context compaction are normalized; hidden summaries do not appear as answers. |
| Implemented | OpenCode turn usage deduplicates billed steps and persists summed turn charges for agents and schedules, including compaction work. |
| Implemented | Office broker requests preserve bounded binary bodies, support admitted Expect/Continue requests and drain partial socket writes before closing. Task deletion, topic changes and app preview routes are available through the existing agent allowlist. |
| Implemented | Webhook managers can copy the existing signing secret without rotation; room peers cannot read it, responses are non-cacheable and clipboard failure is explicit. |
| Implemented | API cards recognize literal single-call curl wrappers and quoted Python display filters. Ambiguous shell commands retain their raw presentation. Help links to the skills library; room tabs constrain touch scrolling and empty lobby presence inputs remain stable. |
| Implemented | Chat headers and agent listings retain an explicit OpenCode engine label even for model identifiers containing another provider’s name. |
| Already covered | Task histories retain old/new values and actor attribution; the office audit page exposes actor and operation filtering. Layout-only differences do not require a second history system. |
| Already covered | Task and schedule routes support direct browser entry and refresh through the office shell. Provider subprocess diagnostics and real PTY behavior have native adapter and fresh-install coverage. |
| Not destination-native | Opening every loopback route through the agent broker would bypass its explicit authorization boundary. Large browser-only uploads remain browser-only; broker request and response bodies remain bounded at 8 MiB. |
| Not destination-native | Implicit popup grants would expand selected-tab browser sharing. Existing target revocation and bounded recovery remain in effect. |
| Not destination-native | Sweat artwork, recording/branding changes and alternative history layouts are presentation choices; Bureau already shows agent work state and elapsed time. |
| Not destination-native | Hosted provisioning, billing, journal retention and database governance do not belong to the self-hosted flat-file architecture. Removing the PTY Node sidecar would break the retained Intel macOS runtime boundary. |
| Not an implemented capability | The proposed OS-user secret-isolation design does not yet establish a working feature to port. |

Validation covers replacement cancellation, provider compaction/retries/usage,
binary Unix-socket round trips and partial writes, app chat in real Chrome,
webhook authorization and conservative API-card parsing. The normal CI gate
and eight fresh-install configurations remain the shipping checks.

App chat uses the office's existing agent permissions and assigned app identity;
it does not create a public anonymous chat endpoint. See [App chat](../features/app-chat.md)
and [OpenCode environments](../features/opencode-environments.md) for boundaries.
