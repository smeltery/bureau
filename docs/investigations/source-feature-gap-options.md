# Source Feature Gap Options

Date: 2026-09-08 (skill-driven residual pass)

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
- First-install welcome agents. On first owner claim of an empty office, Bureau
  seeds one Claude and one Codex welcome agent with fixed outfits and onboarding
  prompts so the new boss can try whichever backend they have set up.
- Edit-message attachment matching and carry-over. Editing a message that had
  attachments strips trailing attachment notice blocks when matching the backend
  transcript, clears the pre-edit queue, and reattaches the original files to
  the replacement turn.
- Live-queue `clientMessageId` TTL dedup. A repeated `clientMessageId` on a
  receiver is reserved for five minutes after accept (including across restarts),
  and agents are told retries are safe for that window.
- Cron-run agent alerts. A live cron-run bearer can list creator-visible agents
  and POST a plain queue message to one of them; attribution is server-derived
  from the job, and human/agent delivery controls are refused.
- Creator `memberPrompt` on cron runs. Each fire looks up the job creator's
  living user record and injects their member prompt into the run system prompt
  (same heading style as desk-agent manager instructions).
- Member room re-show. Members receive accessible rooms (including hidden) as
  `allRooms`, can `GET /api/me/rooms`, and can `PUT /api/me/view/shown` so a
  hidden-but-accessible room can be displayed again.
- Cron-run task board auth. A live cron-run bearer can use `/api/tasks` for
  global tasks only, with creates attributed to the job name; room tasks stay
  out of reach and DELETE is refused.
- Desk-agent task room ACL. Agents see and mutate tasks in rooms their manager
  can access; omit `roomId` on create files in the agent's current room, and
  `roomId:""` files a global.

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
- Interactive lounge/scene editor (drag-handle prop placer with per-object
  inspector). Screenshots of such a tool were reviewed during the 2026-09-08
  pass, but no matching shipped product surface exists in published
  `nmamano/isomux` `main` (no editor routes, asset catalog ids, or UI copy).
  Treat as upstream-local art tooling or an unreleased concept unless product
  owners explicitly request a Bureau-native room decorator.

## Deferred

- In-UI provider Connections (Claude / Codex sign-in). Real product gap, but it
  expands credential and public-API surface; needs an explicit product go-ahead
  before a Bureau-native port.
- Recurring agent-to-agent scheduled messages. Bureau already has cron jobs for
  recurring work; one-off scheduled messages cover reminders and delayed
  handoffs without adding a second recurrence model.
- Strong browser network isolation for preview capture. The host check is an
  input policy for local/private URLs, not a sandbox boundary for redirects or
  subresources.
- A bundled browser dependency. Bureau uses an installed Chrome-compatible
  browser to avoid increasing package size and install complexity.
- Privileged-agent cron job management. Desk agents with operator privilege
  currently steer rooms and agents, not cron CRUD; that is a separate auth
  expansion.
- OpenCode as a third first-class agent backend. Real product gap, but a large
  architecture/public-API change that needs an explicit Bureau design pass.
- Sequenced API-token conversation log (merged send/reply drain with
  Idempotency-Key). Bureau already has a capacity-limited agent-reply inbox;
  full log parity is a public API expansion.
- Full UI i18n catalogs / Catalan. Bureau already has language preference for
  agent replies and speech (en/es); source's full catalog + `ca` is a broader
  localization project.

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
- First-install welcome agents, edit attachment carry-over/matching, and
  `clientMessageId` 5-minute queue TTL dedup.
- Cron-run agent alerts.
- Creator `memberPrompt` injection into cron-run system prompts.
- Member room re-show (`allRooms` for accessible rooms, `GET /api/me/rooms`,
  `PUT /api/me/view/shown`).
- Cron-run authenticated task board (globals-only `/api/tasks` with job-name
  attribution) and desk-agent task visibility via the manager's accessible
  rooms, with matching system-prompt docs.

## Implemented in this pass (2026-09-08)

- Codex drift reduction: bump bundled `@openai/codex` 0.144.6 → 0.153.4,
  regenerate app-server schemas, offer `gpt-6-astra` in the Codex model list
  (Sol remains default), add Codex-only `ultra` effort, and keep Claude UIs
  from selecting `ultra`.
- Seasonal office decorations: calendar-gated string lights (late December),
  desk pumpkin (week before Halloween), and Valentine chocolate box, with
  `?officeDate=` review override. Mounted in the office scene beside room props.
- Generic secret redaction on write for agent and cron conversation logs
  (`prepareLogEntry` / `redactLogEntry`): provider token prefixes and
  `api_key`/`secret`/`token`/`password` assignments are masked before cache,
  WebSocket emit, and JSONL persistence. History is not rewritten.
- Ephemeral slash-echo edit rewrite: editing an ephemeral slash echo (unknown /
  unsupported command) trims the failed echo and re-dispatches via sendMessage
  without an SDK fork, so a typo like `/hepl` → `/help` works even with no
  session and on non-forking backends.
- Multi-species room pets: rooms store `{ species, coat }` (named coats per
  species: cat / dog / rabbit / tortoise). Legacy coat-only values migrate to
  cat. Room settings picks species + coat; the office scene draws the matching
  sleeper (dog bed / basket / sand box).
- Safety-hook shell cwd-set: Bash PreToolUse bureau-write checks track `cd`
  across `;` / `&&` / `||` / newlines, drop the `process.cwd()` fallback for
  missing agent cwd, and fail closed on protected relative candidates and
  unresolvable directory changes (`shell-cwd.ts`).
- Interactive office wall affordances: clock opens schedules, vent opens
  settings, apps plaque opens Apps (corkboard already opens Tasks). Global
  `t` / `s` shortcuts toggle Tasks and open Settings.
- Office settings optimistic concurrency: `GET/PUT /api/office/settings` and
  `update_office_settings` carry a content-hash `version` over prompt+envFile
  (same `versionOf` rail as memory / custom instructions). Missing → 400;
  stale → 409 with the current version before field validation; the office
  settings dialog GETs the version on open.
- Storage/Usage as User Settings panes: Account sidebar entries for Usage
  (any signed-in user) and Storage (owner-only), embedding the existing
  storage/usage surfaces instead of nesting them under Office Settings.
- Pinned human-message banner: extract `pinnedHumanMessageId` /
  `senderIsHuman` and skip agent / app / cron / API-token `user_message`
  entries so the sticky banner keeps human ask context (mirrors isomux
  `pinned-message.ts`).

- Room settings optimistic concurrency on WS/UI: `update_room_settings`
  requires the content-hash `version` from `GET /api/rooms/:id/settings`
  (same rail as the existing REST PUT); the room settings dialog GETs it on
  open. Shared `roomSettingsVersion` lives next to `officeSettingsVersion`.
- Humanized backend failure text: opaque SIGTERM/SIGKILL/signal exits and
  harness `error_during_execution` blobs become readable English sentences
  (`server/agents/session/backend-failure-text.ts`), with the raw diagnostic
  kept in log metadata. Auth classification still runs on the raw text.
  Destination-native (no i18n Translator).
- Boss-facing context wrap-up notices: when a Claude agent's reported window
  crosses 50% (only if maxTokens ≥ 500k) or 75%, emit one ephemeral system line
  per band per conversation (`firedUiThresholds`), separate from the agent-facing
  nudge. Copy points at `/clear` and `/handoff`. Size-gating also applies to the
  agent nudge so small windows skip the noisy 50% band.
- Process rename for OOM discrimination: the office server names itself
  `bureau` via `/proc/self/comm` at boot (`server/process-name.ts`), so
  name-based protectors (e.g. earlyoom) can shield the office without also
  shielding agent `bun` builds. Complements `oom-stamp.ts` score bias.
- Desk vessel by backend: Claude desks draw a coffee mug; Codex desks draw a
  teacup on a saucer (`vesselForAgentType`), so mixed offices show backend at a
  glance without opening chat.
