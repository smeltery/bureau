/**
 * Plugin hook bus + the central `runAgentTurn` helper.
 *
 * `runAgentTurn` is the single entry point for every send-and-await-turn
 * path: sendMessage, flushQueue, executeSkill, editMessage. It owns:
 *
 *   1. Awaiting the previous turn's afterTurnPromise (so memory writes
 *      from the prior turn land before this turn's beforeTurn retrieval).
 *      A stale promise can't poison future turns — see runAfterTurn for
 *      the self-clearing wrapper.
 *   2. Running every enabled plugin's `beforeTurn` in parallel against the
 *      same context. Per-plugin 5s race; on throw or timeout the plugin
 *      contributes no prefix and the failure goes to plugins.jsonl.
 *   3. Assembling per-plugin prefix blocks in alphabetical id order,
 *      delimiter-wrapped, and prepending them to the outgoing text with
 *      a `User message:` separator.
 *   4. beginTurn + createTurnDeferred + session.send + await turn.
 *   5. Snapshotting logCache after the caller's onSendAccepted callback
 *      runs but before the agent's turn output lands, so user_message
 *      entries logged by the caller are excluded from newLogEntries.
 *   6. Firing afterTurn for every plugin in parallel AFTER session.send
 *      was attempted, with status reflecting the post-send outcome
 *      (completed / failed / interrupted). Per-plugin 10s race. The
 *      aggregate promise is stored on `managed.afterTurnPromise` and
 *      self-clears on settle. A turn cancelled DURING plugin retrieval
 *      (Stop / session swap before session.send) skips afterTurn — the
 *      cancel-token check throws SessionSwappedError above the send
 *      lifecycle, so no afterTurn fires for a turn the backend never saw.
 *
 * Each call site keeps its own catch block because the error semantics
 * differ (SessionSwappedError on session swap, edit-fork rollback in
 * editMessage, queue retention in flushQueue). `runAgentTurn` re-throws
 * so the caller's catch handles them; the internal cleanup (rejecting
 * the deferred if session.send threw before await turn ran) is symmetric
 * with the pre-refactor patterns in each call site.
 */

import type { Attachment } from "../../shared/types.ts";
import type { PluginAfterTurnInput, PluginTurnContext } from "../../shared/plugin-types.ts";
import type { ManagedAgent } from "../agents/state.ts";
import { beginTurn, logCache, rooms } from "../agents/state.ts";
import { SessionSwappedError, createTurnDeferred } from "../agents/session/runtime.ts";
import { getEnabledPlugins } from "./registry.ts";
import { assistantTextFromEntries, runAfterTurn, runBeforeTurnHooks } from "./turn-hooks.ts";
import { applyPluginPrefixes } from "./plugin-prefix.ts";
export { stripPluginPrefix } from "./plugin-prefix.ts";

export type TurnOrigin = "user" | "queued" | "skill" | "edit-fork";

export interface RunAgentTurnOpts {
  managed: ManagedAgent;
  /** What the user typed verbatim (e.g. "/grill"). For plugin context only;
   *  not sent. */
  visibleText: string;
  /** Semantic user input WITHOUT sender prefix or plugin prefix blocks. For
   *  normal sends it's the raw user text; for skills it's the expanded
   *  skill prompt; for queued flushes it's the per-item bodies joined.
   *  This is what plugins should query against / store as "the user's
   *  message" — sender prefixes like `[Nil]` are bureau routing noise,
   *  not intent. */
  originalText: string;
  /** Pre-prefix outgoing text, with sender prefix already applied. Plugin
   *  prefix blocks (if any) get prepended; the result is what session.send
   *  actually receives. */
  sdkText: string;
  /** Username attributed to this turn (the boss who sent it). Null when the
   *  send is not user-attributed (e.g. cronjob runs or agent-to-agent
   *  messages where the sender is another agent rather than a user). */
  username: string | null;
  attachments?: Attachment[];
  origin: TurnOrigin;
  humanInput: boolean;
  /** Called synchronously after session.send resolves and BEFORE the
   *  newLogEntries snapshot is taken. Use this for "log only on send-
   *  accepted" patterns — flushQueue uses it to write user_message entries
   *  and drain its queue once the backend has accepted the prompt. Any
   *  entries logged here land BEFORE the snapshot and are therefore
   *  excluded from `PluginAfterTurnInput.newLogEntries`. */
  onSendAccepted?: () => void;
}

/** Owns the entire send-and-await-turn lifecycle, including plugin hooks.
 *  Throws through whatever the underlying turn threw so callers' catch
 *  blocks continue to handle SessionSwappedError / etc. with their
 *  existing semantics. */
export async function runAgentTurn(opts: RunAgentTurnOpts): Promise<void> {
  const { managed, sdkText, originalText, visibleText, attachments, origin, humanInput, username, onSendAccepted } = opts;
  const agentId = managed.info.id;

  // 1. Claim the turn lifecycle immediately, BEFORE any await. The
  // afterTurnPromise gate (up to 10s) plus per-plugin beforeTurn (up to 5s
  // each) would otherwise leave the agent in idle / waiting_for_response
  // state for the duration — concurrent ingress (sendMessage, executeSkill,
  // enqueueMessage's "idle" branch) would see the agent as not-busy and
  // skip the queue, leading to either a deferred supersession or two
  // send() calls racing into the same backend session.
  //
  // beginTurn is idempotent on state ("thinking" → early-return), so an
  // earlier early-echo beginTurn at a call site remains harmless when
  // runAgentTurn re-enters here.
  beginTurn(agentId, { humanInput });

  // Snapshot the cancel token immediately after beginTurn. Any control-plane
  // action that would normally cancel an in-flight turn (abort, kill,
  // replaceSession via /clear / /resume / /model / edit-fork) bumps this
  // counter. We re-check after each await during the pre-send window and
  // bail with SessionSwappedError if it changed — pendingTurn isn't
  // installed yet, so the usual rejection path can't reach us.
  const cancelTokenAtEntry = managed.turnCancelToken;
  const checkCancelled = () => {
    if (managed.turnCancelToken !== cancelTokenAtEntry) {
      throw new SessionSwappedError("Turn cancelled during plugin retrieval.");
    }
  };

  // 2. Gate on the previous turn's afterTurn. The promise stored on
  // `managed.afterTurnPromise` self-clears via runAfterTurn's .finally
  // hook, so even a previously timed-out afterTurn doesn't block this turn.
  if (managed.afterTurnPromise) {
    try {
      await managed.afterTurnPromise;
    } catch {
      // runAfterTurn catches plugin throws internally; defensive in case a
      // future hook here is added that can throw.
    }
    checkCancelled();
  }

  // 3. Build the plugin context. The room lookup is defensive: agents are
  // always assigned to a valid room, but a race during room close could
  // leave an out-of-range index briefly.
  const room = rooms[managed.info.room];
  const ctx: PluginTurnContext = {
    agentId,
    agentName: managed.info.name,
    roomId: room?.id ?? "",
    roomName: room?.name ?? "",
    sessionId: managed.sessionId,
    cwd: managed.info.cwd,
    username,
    visibleText,
    originalText,
    sdkText,
  };

  // 4. Run beforeTurn for every enabled plugin in parallel. getEnabledPlugins
  // already returns entries sorted by id; we preserve that order in the
  // assembled prefix.
  const loaded = getEnabledPlugins();
  const plugins = loaded.map((lp) => lp.plugin);
  const prefixes = await runBeforeTurnHooks(plugins, ctx, origin);
  if (plugins.length > 0) {
    // beforeTurn could have taken up to BEFORE_TURN_TIMEOUT_MS per plugin;
    // re-check the cancel token before committing to send.
    checkCancelled();
  }

  // 5. Assemble the final outgoing text.
  const finalText = applyPluginPrefixes(prefixes, sdkText);

  // Final pre-send cancel check. Catches a Stop/swap that fires after the
  // beforeTurn loop returned but before createTurnDeferred runs — small
  // window but legitimately reachable since assembling the prefix yields
  // the microtask queue.
  checkCancelled();

  // 6. Install the per-turn deferred. Held close to session.send so we don't
  // park a pendingTurn through the plugin retrieval phase — the state gate
  // above is what serializes turns; pendingTurn is what makes session.send /
  // await turn cancellable on session swap.
  const turn = createTurnDeferred(managed);
  const ownPending = managed.pendingTurn;

  // 7. Send. Snapshot the logCache AFTER onSendAccepted runs but BEFORE the
  // agent's turn output starts arriving via processMessage — that's the
  // window in which "new entries produced by this turn" is well-defined.
  let snapshotIdx = 0;
  let status: PluginAfterTurnInput["status"] = "completed";
  let thrown: unknown = undefined;

  try {
    if (!managed.session) {
      throw new Error("Cannot send: agent has no session.");
    }
    await managed.session.send(finalText, attachments);
    if (onSendAccepted) {
      try {
        onSendAccepted();
      } catch (err) {
        // onSendAccepted is caller-controlled (typically log entries +
        // queue drain). A throw here would be a caller bug — the turn is
        // already in flight on the backend, so we log and continue.
        console.error(`[runAgentTurn] onSendAccepted threw:`, err);
      }
    }
    snapshotIdx = logCache.get(agentId)?.length ?? 0;
    await turn;
  } catch (err) {
    thrown = err;
    // Symmetric with the pre-refactor patterns in sendMessage / flushQueue /
    // executeSkill / editMessage: if session.send (or anything before
    // `await turn`) threw, the deferred we installed is still parked in
    // managed.pendingTurn — reject + clear only when we still own it so
    // awaiting callers don't hang and concurrent abort/state logic doesn't
    // observe a phantom in-flight turn.
    if (ownPending && managed.pendingTurn === ownPending) {
      managed.pendingTurn = null;
      try {
        ownPending.reject(err);
      } catch {
        // Already-rejected deferred — fine.
      }
    }
    // SessionSwappedError = user-initiated swap (abort, /resume, /model,
    // /clear, editMessage fork install) OR a pre-send cancel detected by
    // checkCancelled above. Map to "interrupted" so plugins can distinguish
    // from real failures.
    status = err instanceof SessionSwappedError ? "interrupted" : "failed";
  }

  // 8. Fire afterTurn for every plugin. Even on failure / interruption —
  // memory plugins may want to observe the boundary, audit plugins always
  // want the record, etc. The aggregate promise self-clears on settle.
  if (loaded.length > 0) {
    const allEntries = logCache.get(agentId) ?? [];
    const newLogEntries = allEntries.slice(snapshotIdx);
    const input: PluginAfterTurnInput = {
      status,
      userTextSent: finalText,
      assistantText: assistantTextFromEntries(newLogEntries),
      newLogEntries,
    };
    managed.afterTurnPromise = runAfterTurn(plugins, ctx, input, origin, managed);
  }

  if (thrown !== undefined) {
    // Re-throw whatever the underlying turn threw so the caller's catch
    // handles its own error semantics. Cast through Error: every realistic
    // throw site (session.send / await turn / pre-send guards) produces an
    // Error subclass.
    throw thrown as Error;
  }
}
