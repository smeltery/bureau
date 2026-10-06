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

Pager history is retained in the existing JSON store and loaded in memory. A
future bounded-query/pagination design may be useful for high-volume offices;
this change does not silently erase incidents to limit storage. Pages deleted
by previous versions cannot be recovered without a backup.

On-demand jobs use the existing manual-run authorization and lifecycle. The
enabled toggle controls timed runs; explicit Run now remains available even
when paused, matching recurring jobs. Signed webhook deliveries use the same run lifecycle without changing the timer cadence.
