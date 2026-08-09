# Slide Mode

A per-device toggle that presents an agent conversation as a deck: one position
per assistant turn, each one a slide a model designed from that turn's answer.

Reading a long agent answer in a chat log means scrolling prose. Slide Mode is
for the other thing you sometimes want — to _look_ at what the agent concluded,
or to put it in front of someone else.

## The shape

| Module                      | Job                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `shared/slide-turns.ts`     | splits a conversation into deck positions, anchored on the `user_message` that started each turn |
| `server/slides/prompt.ts`   | the formatter system prompt — the part that decides whether slides look designed                 |
| `server/slides/generate.ts` | the generation lifecycle: queue, dedupe, gating, commit                                          |
| `server/slides/sanitize.ts` | what the model is allowed to have produced                                                       |
| `server/slides/store.ts`    | the sidecar that persists slides per conversation                                                |
| `shared/slide-frame.ts`     | builds the sandboxed iframe document a slide renders in                                          |
| `ui/log-view/deck/`         | the deck: request policy, states, rendering                                                      |

A slide is produced by a **second, tool-less model pass** over one settled turn,
run on the agent's own backend and subscription — the same primitive topic
generation uses. It is a cheap-tier call (`sonnet` for Claude agents, Codex
agents on their own family), not a call to whatever expensive model the agent
itself runs on.

## What it costs

One model call per turn, **the first time you look at that turn in Slide Mode**.
Nothing is generated eagerly: the deck asks for the position you are on and one
neighbour, so opening a conversation to turn 40 does not format the previous 39.
A committed slide is served from the store, so revisiting a turn — or reopening
the deck later, or on another device — costs nothing. Turns that produce no
assistant text commit a placeholder with no model call at all.

If Slide Mode is off, none of this runs.

## Model output is hostile input

A slide is HTML a language model wrote, about to be rendered in the operator's
browser. Two independent barriers, because either one alone would be a single
point of failure:

**The sanitizer** (`sanitize.ts`) requires a single root `<div>` and rejects
banned elements, `src`/`href`, `on*` handlers, and CSS `url()`. It is written to
tell markup from prose: a code block that _mentions_ `href=` or `data:` is
allowed through, because slides about web development are a normal thing to want.

**The frame.** A slide renders only inside an iframe, never injected into the app
DOM:

- the **display** frame is `sandbox=""` — an opaque origin with nothing granted —
  under a deny-everything CSP;
- a second **offscreen measure** frame adds `allow-same-origin` for one purpose:
  so the parent can read `scrollHeight` and lay an overfull slide out at its
  natural height, scaling it down whole rather than clipping it. This does not
  weaken the boundary. `allow-scripts` is absent and `script-src` is `'none'`, so
  even a prompt-injected `<script>` is inert; `default-src 'none'` blocks every
  subresource and fetch. The parent reads a number out of a script-dead,
  network-dead document.

If you change either barrier, assume the other is already compromised and ask
whether the change still holds.

## Caching keys on content, not time

Slides live in `~/.bureau/state/slides/<agentId>/<rootSessionId>.json`, keyed by
the turn's anchor entry id.

**Root session, so edit-forks of one conversation share a deck.** Orphaned keys
from abandoned branches are harmless and can be pruned against the live log.

**Each record carries a digest of the turn content it was made from**, and a
stored slide is served only while that digest still matches the live turn. That
is the cache-validity signal instead of a timestamp, and it exists for a specific
failure: a turn that was empty when you first looked at it (so a placeholder was
recorded) and _gained_ text afterwards would otherwise show the placeholder
forever. A record written before the digest field existed is unverifiable, so it
regenerates once.

Slides are deliberately **not** log entries: on-demand backfill arrives out of
order, and the log stays pure chat.

## Generation is bounded, and never formats a half-finished answer

- At most two generations per agent at a time.
- In-flight requests dedupe on conversation plus turn, so mashing a position does
  not queue duplicates.
- A forced regeneration coalesces into exactly one rerun, with the latest
  feedback winning.
- **A turn that is still streaming is parked, not formatted.** Otherwise the
  slide would describe half an answer. Parked requests drain when the turn
  settles.
- At commit, both conversation identity and content digest are re-checked. A
  slide for a conversation that has since been cleared, resumed or forked is
  discarded in silence rather than written over a live turn.

That last gate needs to know which turn is live, which is why `ManagedAgent`
tracks the anchor entry id of the in-flight turn (with a parking slot for the
case where the `user_message` is logged before the turn's deferred exists).

## What you see

| State       | Deck shows                                                                     |
| ----------- | ------------------------------------------------------------------------------ |
| ready       | the slide, in the sandboxed frame, scaled to fit                               |
| pending     | a spinner. **No timeout flips it** — a push says when it is done or has failed |
| failed      | the raw answer, so the turn is still readable, plus why                        |
| placeholder | "no answer to show", or the turn's error text                                  |

Every drawn state offers regeneration with an optional one-shot instruction
("more diagram, less text"). The prompt that started the turn is frozen beneath
the stage.

## API

| Route                                  | Behaviour                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /api/agents/:id/slides`           | the conversation's deck; no live session answers `{sessionId: null, slides: {}}`     |
| `POST /api/agents/:id/slides/:entryId` | ensure: `ready` \| `pending` \| `unavailable`; body may carry `force` and `feedback` |

Unavailability is a **200 payload the client branches on**, not an error —
following the `contextUsage` precedent. Generation is fire-and-forget: the
finished slide arrives on a `slide_ready` push (with `slide_failed` as its
companion), so no HTTP handler ever waits on a model. Both routes use the same
room-visibility rule as reading an agent's logs.
