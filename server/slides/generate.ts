// Slide Mode generation.
//
// The second, tool-less model pass that turns one assistant turn into ONE
// self-contained HTML slide. Runs on the AGENT'S OWN backend via
// backend.oneShotPrompt (Claude agents on family "sonnet", Codex agents on a
// cheap GPT-5.x family) - the same subscription-auth primitive topic generation
// uses (server/agents/topic.ts).
//
// This module owns: the per-turn generation lifecycle, output commit, and the
// per-agent generation queue (max 2 concurrent, in-flight dedupe,
// conversation-identity stale guard). The system prompt and the per-turn user
// prompt live in ./prompt.ts, output sanitizing in ./sanitize.ts, and the
// injected-deps contract in ./contract.ts (re-exported here so consumers have
// one entry point). It stays ignorant of the agent manager's internals -
// everything it needs to reach live state arrives through SlideModeDeps.

import { errMessage } from "../../shared/errors.ts";
import type { SlideFailureReason, SlideRecord } from "../../shared/slides.ts";
import { slideContentDigest } from "../../shared/slide-turns.ts";
import { slideMatchesTurn, type EnsureResult, type SlideJobContext, type SlideModeDeps } from "./contract.ts";
import { buildFormatterPrompt, SLIDE_SYSTEM_PROMPT } from "./prompt.ts";
import { extractSlideHtml } from "./sanitize.ts";

export { SLIDE_CODEX_MODEL_FAMILY, slideMatchesTurn, slideModelFamily } from "./contract.ts";
export type { EnsureResult, SlideBackend, SlideJobContext, SlideModeDeps } from "./contract.ts";

const MAX_CONCURRENT = 2;

export function createSlideMode(deps: SlideModeDeps) {
  const now = deps.now ?? (() => Date.now());
  // Per-agent concurrency gate. `active` counts running generations; waiters
  // queue for a freed slot. A released slot is HANDED to a waiter (active
  // unchanged) rather than decremented, so the cap holds.
  const active = new Map<string, number>();
  const waiters = new Map<string, Array<() => void>>();
  // In-flight dedupe. Keyed by `${agentId}::${rootSessionId}::${entryId}` - the
  // root is part of the key so a re-request after a /clear or a /resume into
  // another thread starts a FRESH job instead of deduping against a
  // stale-conversation job that the commit guard will drop, which would leave the
  // turn with no live generation. Each entry carries a coalesced rerun request so
  // rapid force-regens don't race competing writers: the latest feedback wins and
  // runs once the current pass finishes.
  const inFlight = new Map<string, { rerun: boolean; feedback: string | null }>();
  // Turns whose slide a client requested WHILE they were still in flight
  // (non-terminal). ensureSlide can't generate a settled slide yet, so it parks
  // the request here (keeping the latest feedback/force intent) and returns
  // pending; onTurnSettled drains it once the turn settles by ANY path,
  // guaranteeing the promised slide_ready. Keyed `${agentId}::${entryId}` (the
  // current-conversation turn is re-resolved at drain time; the commit guard drops
  // anything a reset stranded).
  const deferred = new Map<string, { force: boolean; feedback: string | null }>();

  function acquire(agentId: string): Promise<void> {
    const n = active.get(agentId) ?? 0;
    if (n < MAX_CONCURRENT) {
      active.set(agentId, n + 1);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const q = waiters.get(agentId) ?? [];
      q.push(resolve);
      waiters.set(agentId, q);
    });
  }

  function release(agentId: string): void {
    const q = waiters.get(agentId);
    if (q && q.length > 0) {
      const next = q.shift();
      if (q.length === 0) waiters.delete(agentId);
      next?.(); // slot handed off - active stays the same
      return;
    }
    const n = active.get(agentId) ?? 1;
    if (n <= 1) active.delete(agentId);
    else active.set(agentId, n - 1);
  }

  // Is the turn we generated from STILL the live one? Re-resolves the
  // authoritative turn at the outcome boundary: the conversation must not have
  // moved on, and the turn must still be TERMINAL and still carry the content we
  // generated from - asserting the core invariant (no write for a non-terminal
  // turn) and guarding the window where content changed while generation ran (a
  // fork). Both outcomes hang off this: a mismatched SUCCESS is discarded (the
  // next view reconciles via the digest), and a mismatched FAILURE is not
  // reported to the client, because a discarded result isn't a failed slide.
  function stillTheLiveTurn(agentId: string, entryId: string, job: SlideJobContext): boolean {
    if (!deps.isCurrent(agentId, job.rootSessionId)) return false;
    const live = deps.resolveJob(agentId, entryId);
    return !!live && live.terminal && slideContentDigest(live.turn) === slideContentDigest(job.turn);
  }

  // Write + broadcast, but only if the conversation hasn't moved on.
  function commit(agentId: string, entryId: string, job: SlideJobContext, partial: { html: string | null; placeholder: boolean; errorText: string | null }): void {
    if (!stillTheLiveTurn(agentId, entryId, job)) return;
    const rec: SlideRecord = {
      html: partial.html,
      placeholder: partial.placeholder,
      errorText: partial.errorText,
      promptText: job.turn.promptText,
      model: job.modelFamily,
      createdAt: now(),
      // Stamp the content this slide was generated from so a later view can tell
      // whether it still matches the turn (see slideMatchesTurn).
      contentDigest: slideContentDigest(job.turn),
    };
    deps.writeSlide(agentId, job.rootSessionId, entryId, rec);
    deps.onSlideReady(agentId, job.rootSessionId, entryId, rec);
  }

  // Run one generation pass. Returns null on success, or the failure code when
  // the pass ended terminally badly (the formatter threw, or its output violated
  // the slide contract). The CALLER decides whether to report it - see drive.
  async function runGeneration(job: SlideJobContext, agentId: string, entryId: string, feedback: string | null): Promise<SlideFailureReason | null> {
    // Empty / interrupted / tool-only turns get a placeholder record with no
    // LLM call - the deck still shows a position, mirroring the chat 1:1.
    if (job.turn.placeholder) {
      commit(agentId, entryId, job, { html: null, placeholder: true, errorText: job.turn.errorText });
      return null;
    }
    await acquire(agentId);
    // Which half of the pass we are in, so the catch can classify without
    // inspecting the error: everything up to and including the backend call is
    // the generation, everything after is the contract check.
    let stage: SlideFailureReason = "generation_failed";
    try {
      const backend = deps.resolveBackend(job.agentType);
      const prompt = buildFormatterPrompt(job.turn, job.prevSlideHtml, feedback);
      const raw = await backend.oneShotPrompt(prompt, {
        cwd: job.cwd,
        modelFamily: job.modelFamily,
        systemPrompt: SLIDE_SYSTEM_PROMPT,
      });
      stage = "invalid_output";
      const html = extractSlideHtml(raw);
      commit(agentId, entryId, job, { html, placeholder: false, errorText: null });
      return null;
    } catch (err) {
      // The DETAIL is journalled and goes no further: it is backend/provider
      // exception text, or an excerpt of raw model output, and slide_failed
      // reaches every session that can see the room. What crosses the wire is
      // the classification only. No record is written; the client learns from
      // the push and shows the raw-answer fallback.
      console.error(`[slides] formatter failed (${stage}) for ${agentId} turn ${entryId}:`, errMessage(err));
      return stage;
    } finally {
      release(agentId);
    }
  }

  // Drive one turn's generation, then honor any force-regen that arrived while
  // it ran (latest feedback wins). Serial per key, so there is never more than
  // one writer for a (agent, conversation, turn) at a time.
  //
  // Failure is reported once, for the LAST pass only: a failed pass with a
  // rerun already queued behind it isn't terminal - announcing it would flash
  // the fallback on a slide that is about to be retried anyway.
  async function drive(job: SlideJobContext, agentId: string, entryId: string, key: string, firstFeedback: string | null, entry: { rerun: boolean; feedback: string | null }): Promise<void> {
    try {
      let reason = await runGeneration(job, agentId, entryId, firstFeedback);
      while (entry.rerun) {
        entry.rerun = false;
        reason = await runGeneration(job, agentId, entryId, entry.feedback);
      }
      // Only for a turn that is still the live one - a result discarded because
      // the conversation reset or the content forked is not a failed slide.
      if (reason !== null && stillTheLiveTurn(agentId, entryId, job)) {
        deps.onSlideFailed(agentId, job.rootSessionId, entryId, reason);
      }
    } finally {
      inFlight.delete(key);
    }
  }

  // Start (or coalesce into) a generation for one turn, fire-and-forget. `force`
  // only matters when a generation is already in flight: a plain duplicate
  // request dedupes silently, while a force queues a single rerun (latest
  // feedback wins) so a regenerate isn't lost.
  function launch(agentId: string, entryId: string, job: SlideJobContext, force: boolean, feedback: string | null): void {
    const key = `${agentId}::${job.rootSessionId}::${entryId}`;
    const existing = inFlight.get(key);
    if (existing) {
      if (force) {
        existing.rerun = true;
        existing.feedback = feedback;
      }
      return;
    }
    const entry = { rerun: false, feedback: null as string | null };
    inFlight.set(key, entry);
    void drive(job, agentId, entryId, key, feedback, entry);
  }

  // Ensure a slide for one turn. The invariant: a slide is generated only for a
  // TERMINAL turn, and a cached slide is served only while it still matches that
  // turn's content.
  //   - non-terminal (the still-running newest turn) -> park a waiter, pending;
  //   - terminal + cache matches -> ready (unless force);
  //   - terminal + miss/stale/force -> (re)generate, pending.
  // `force` regenerates even a matching cache (per-slide ↻), optionally with a
  // one-shot `feedback` instruction.
  function ensureSlide(agentId: string, entryId: string, opts?: { force?: boolean; feedback?: string | null }): EnsureResult {
    const job = deps.resolveJob(agentId, entryId);
    if (!job) return { status: "unavailable" };
    if (!job.terminal) {
      // Not settled yet: never format a half-streamed answer or record a
      // placeholder that the arriving answer would make stale. Park the request;
      // onTurnSettled generates + broadcasts when this turn settles. Coalesce
      // intent: force is sticky (a ↻ during the turn must not be lost to a later
      // plain prefetch), and the latest FORCE's feedback wins.
      const prev = deferred.get(`${agentId}::${entryId}`);
      deferred.set(`${agentId}::${entryId}`, {
        force: (prev?.force ?? false) || !!opts?.force,
        feedback: opts?.force ? (opts?.feedback ?? null) : (prev?.feedback ?? null),
      });
      return { status: "pending" };
    }
    const cached = deps.readSlide(agentId, job.rootSessionId, entryId);
    const stale = cached ? !slideMatchesTurn(cached, job.turn) : false;
    if (cached && !stale && !opts?.force) {
      return { status: "ready", slide: cached };
    }
    // Miss, forced, or a stale cache (e.g. a placeholder whose turn has since
    // gained text) -> regenerate; force so a stale record is overwritten.
    launch(agentId, entryId, job, !!opts?.force || stale, opts?.feedback ?? null);
    return { status: "pending" };
  }

  // A turn SETTLED (by any path: turn_completed, error, stream end, session
  // swap, kill, supersession - every one settles the pendingTurn promise). Fulfil
  // any request a client parked while the turn was in flight: generate the
  // settled slide (real content -> slide, empty/interrupted -> placeholder) and
  // broadcast slide_ready, so the client's pending never orphans. Re-reads the
  // turn from live state, so it sees the complete answer; if the turn is gone
  // (a /clear removed it) there is nothing to show and the drained request is
  // simply dropped (its deck position is gone too). No parked request -> nothing
  // generated (the view-driven cost model holds).
  function onTurnSettled(agentId: string, entryId: string): void {
    const key = `${agentId}::${entryId}`;
    const req = deferred.get(key);
    if (!req) return;
    deferred.delete(key);
    const job = deps.resolveJob(agentId, entryId);
    if (!job || !job.terminal) return;
    launch(agentId, entryId, job, req.force, req.feedback);
  }

  return { ensureSlide, onTurnSettled };
}

export type SlideMode = ReturnType<typeof createSlideMode>;

// Drive the Slide Mode "turn settled" drain off a turn's completion promise.
// Whatever settles that promise - turn_completed, normalized error, clean stream
// end, stream catch, session swap, kill, or supersession - settles it exactly
// once, resolve OR reject, and each is a terminal fact for the turn. So onSettled
// fires exactly once with the turn's anchor entry id (read AT settle time, after
// pendingTurn may have been nulled; a null anchor -> no-op). Kept as a pure
// helper (used where the turn's deferred is created) so the resolve- and
// reject-path wiring is unit-testable without standing up the whole manager. The
// trailing .catch keeps a rejected turn from surfacing as an unhandled rejection.
export function drainOnSettle(promise: Promise<void>, getAnchorEntryId: () => string | null, onSettled: (entryId: string) => void): void {
  void promise
    .finally(() => {
      const anchor = getAnchorEntryId();
      if (anchor) onSettled(anchor);
    })
    .catch(() => {});
}
