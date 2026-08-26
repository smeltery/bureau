# Source Feature Gap Options

Date: 2026-08-26 (updated after feature-gap pass against nmamano/isomux)

This investigation records accepted, rejected, and deferred options from a
source feature-gap comparison. Source behavior was used as evidence;
implementation stays in Bureau naming and architecture.

## Accepted

- One-off scheduled agent messages. Agents can schedule a future message with
  `deliverAt`, including self-reminders, and inspect or cancel their pending
  outbox.
- Browser preview cards. Agents can request a screenshot of a local/private
  development URL and surface it as an image card in chat.
- Codex drift reduction. Bureau should keep the bundled Codex launcher and
  offered Codex model list current enough for the embedded Codex backend.
- Instant self-handoff REST endpoint. `POST /api/agents/:id/handoff` resets an
  agent session and delivers a forward-looking brief into the fresh session in
  one call, with a self-handoff prefix so the clean copy does not reply to
  itself. Agents may hand off only themselves; privileged operators may hand off
  visible agents.

## Rejected

- Source branding, repository identity, release scripts, and upstream-specific
  infrastructure. These do not fit Bureau's product identity.
- Public-URL screenshotting. Bureau's preview affordance is scoped to local and
  private development servers, not general web capture.
- Silent coercion of preview dimensions or waits. Invalid inputs should return
  an error so an agent does not mistake a changed screenshot configuration for
  the requested one.
- Hosted control plane, billing, VPS unattended installer, and in-UI one-click
  update apply. Bureau is self-hosted product software, not the upstream hosted
  SaaS or its deploy automation.

## Deferred

- Recurring agent-to-agent scheduled messages. Bureau already has cron jobs for
  recurring work; one-off scheduled messages cover reminders and delayed
  handoffs without adding a second recurrence model.
- Strong browser network isolation for preview capture. The host check is an
  input policy for local/private URLs, not a sandbox boundary for redirects or
  subresources.
- A bundled browser dependency. Bureau uses an installed Chrome-compatible
  browser to avoid increasing package size and install complexity.

## Implemented since the prior note (2026-07-14)

- Pending prompt visibility (`pendingPrompt`) on manifests, logs, desk chips, and chat headers.
- Memory cap turn-start notices when auto-loaded scopes are near their size caps.
- Custom instructions optimistic concurrency via `customInstructionsVersion` on read and PATCH.
- Sender-visible failure notices for scheduled messages that can no longer be
  delivered. The sender now receives a system log entry when a due message is
  dropped after the delivery deadline or because the receiver no longer exists.
- Kaomoji browser-tab faces for focused agents (`ui/agent-tab-label.ts`).
- Live app previews and richer agent spawn templates (separate parity commits on
  master prior to this pass).
