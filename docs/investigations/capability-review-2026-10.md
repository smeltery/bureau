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

## Integration follow-ups

These are real gaps requiring coordinated changes beyond the independent fixes
above; they are not claimed as implemented:

| Capability | Required work and boundary |
| --- | --- |
| Signed inbound webhooks | Introduce signature verification over raw bodies, bounded ingress, replay handling, a secret store excluded from backups, delivery records, target authorization at dispatch, and management UI. Public ingress must not bypass existing machine-token restrictions. |
| Room-scoped schedules | Migrate creator-owned jobs and historical runs to explicit room ownership, then apply consistent visibility to REST reads, WebSocket snapshots/events, usage, and manual triggers. Changing only the picker would expose or hide data inconsistently. |
| Browser tab sharing through an extension | Requires a separately packaged extension, pairing, per-tab grants, expiry/revocation, and protocol lifecycle tests. Bureau currently uses an opt-in host browser with local/private URL policy. |
| App thumbnails and archive view | Requires upload ownership/limits, media serving and cleanup, and a distinct archive lifecycle. Existing data retirement on deletion already preserves files. |
| Personal room ordering and tucked-room controls | Audit the existing office-wide reorder protocol before introducing independent per-member ordering and optimistic updates. The Settings list fix preserves the current access and ordering model. |

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
when paused, matching recurring jobs. No webhook endpoint is added here.
