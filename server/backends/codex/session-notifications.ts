import type { AttachmentSpec, NormalizedEvent } from "../types.ts";
import type { JsonRpcNotification } from "./client-types.ts";
import { translateCompletedItem } from "./completed-items.ts";
import { AUTH_ERROR_PATTERNS } from "./config.ts";
import { mapTurnStatus } from "./protocol-format.ts";
import type { CodexUsageTracker } from "./session-usage.ts";
import type { ThreadTokenUsageUpdatedNotification } from "./_generated/v2/ThreadTokenUsageUpdatedNotification.ts";

export interface CodexNotificationDeps {
  threadId: string | null;
  selfInterruptedForAuth: boolean;
  authSignalEmittedThisTurn: boolean;
  usage: CodexUsageTracker;
  setActiveTurnId(turnId: string | null): void;
  clearTurnInFlight(): void;
  resetAuthTurnState(): void;
  enqueue(event: NormalizedEvent): void;
  enqueueAuthAwareSystemText(text: string): void;
  attachmentFromPath(rawPath: unknown): AttachmentSpec | null;
}

export function handleCodexNotification(n: JsonRpcNotification, deps: CodexNotificationDeps): void {
  const params = n.params as Record<string, unknown> | null | undefined;
  // Per-thread filter: every notification carrying a threadId must match
  // ours. Sub-agent / review-mode child threads have their own ids.
  const eventThreadId = params?.threadId;
  if (eventThreadId !== undefined && deps.threadId && eventThreadId !== deps.threadId) {
    return;
  }

  switch (n.method) {
    // ---- Turn lifecycle ----
    case "turn/started": {
      const turn = params?.turn as { id?: string } | undefined;
      if (turn?.id) deps.setActiveTurnId(turn.id);
      break;
    }
    case "turn/completed": {
      const turn = params?.turn as
        | {
            status?: string;
            error?: { message?: string } | null;
          }
        | undefined;
      const rawStatus = mapTurnStatus(turn?.status);
      const rawError = turn?.error?.message ?? undefined;
      const wasSelfInterruptForAuth = deps.selfInterruptedForAuth;
      deps.setActiveTurnId(null);
      deps.clearTurnInFlight();
      // "Model not supported" safety net. The spawn / edit dialog now
      // fetches model/list per-auth, so this branch should be rare —
      // most commonly it'll fire when the user's auth tier changed since
      // the agent was created. Re-opening settings reloads the list.
      if (rawError && /model.*not supported|not supported.*model/i.test(rawError)) {
        deps.enqueue({
          kind: "system_text",
          text: "This Codex model isn't available on your current login. Open the agent's settings to refresh the model list and pick one that is.",
        });
      }
      // If we self-interrupted to short-circuit a doomed-by-auth turn,
      // remap status="interrupted" → "failed" so the user sees a clear
      // failure (not a misleading "interrupted" — which the UI treats as
      // a user-initiated stop). Substitute the error to the same auth
      // summary used for the stderr-driven path; the codex-emitted error
      // on a client-interrupt is usually empty or unhelpful.
      const status = wasSelfInterruptForAuth ? "failed" : rawStatus;
      // Substitute the turn-level error to a non-auth-shaped summary so
      // agent-manager's auth-detect path doesn't re-fire on the same root
      // cause. The user still has the concrete 401 detail from the earlier
      // [codex stderr] system_text. Whole-string substitution (not
      // keyword-stripping) keeps the rewritten message readable.
      const turnLevelAuthShaped = !!rawError && AUTH_ERROR_PATTERNS.test(rawError);
      const causedByAuth = deps.authSignalEmittedThisTurn && (wasSelfInterruptForAuth || turnLevelAuthShaped);
      const error = causedByAuth ? "Codex turn failed after an auth error; see the prior Codex auth notice." : rawError;
      // Close the per-turn auth-coalescing gate now that the turn has
      // settled. Next user send opens it again in send().
      deps.resetAuthTurnState();
      deps.enqueue({
        kind: "turn_completed",
        status,
        error,
        // Signal causedByAuth so agent-manager keeps the agent in
        // waiting_for_response (auth issue → user needs to sign in)
        // instead of "error" (which would imply something crashed).
        // The error string itself is rewritten to a non-auth-shaped
        // summary above, so the orchestrator's auth-detect regex
        // wouldn't catch it.
        ...(causedByAuth ? { causedByAuth: true } : {}),
      });
      break;
    }

    // ---- Token usage ----
    // Wire shape: ThreadTokenUsageUpdatedNotification (v2). The payload
    // carries two breakdowns: `total` (cumulative since thread start) and
    // `last` (most recent turn only). We use them for different things:
    //   - `total` → usage_update delta (lifetime billing accounting)
    //   - `last`  → /context snapshot (current context fullness)
    // TokenUsageBreakdown field semantics (per OpenAI):
    //   inputTokens   = prompt total (incl. cache hits)
    //   cachedInputTokens = subset that came from cache
    //   outputTokens  = completion tokens (reasoning is a subset for
    //                    reasoning-capable models, not separate)
    //   reasoningOutputTokens = reasoning subset of outputTokens
    // Translation to our Claude-style TokenUsage:
    //   ours inputTokens = inputTokens - cachedInputTokens (new prompt)
    //   ours cacheReadInputTokens = cachedInputTokens
    //   ours cacheCreationInputTokens = 0 (Codex doesn't separate)
    //   ours outputTokens = outputTokens (reasoning already included)
    case "thread/tokenUsage/updated": {
      // Typed against the generated v2 schema so tsc catches future wire
      // drift — this handler was previously broken by exactly that kind of
      // schema mismatch (was reading `params.usage`, never existed in v2).
      const notif = params as ThreadTokenUsageUpdatedNotification | null | undefined;
      if (!notif?.tokenUsage) break;
      deps.enqueue({ kind: "usage_update", tokenUsage: deps.usage.applyTokenUsageNotification(notif) });
      break;
    }

    // ---- Item lifecycle ----
    case "item/started":
      // Carries the full ThreadItem but we wait for completion.
      break;
    case "item/completed": {
      const item = params?.item;
      if (item) {
        for (const ev of translateCompletedItem(item, (rawPath) => deps.attachmentFromPath(rawPath))) {
          deps.enqueue(ev);
        }
      }
      break;
    }
    // Streaming deltas (item/agentMessage/delta, item/reasoning/textDelta,
    // item/reasoning/summaryTextDelta) are intentionally ignored. Codex
    // emits them at sub-word granularity (one entry per token), and
    // Bureau's log-view treats each text entry as its own row — surfacing
    // every delta produces a wall of one-word lines followed by the same
    // text repeated whole on item/completed. Single-entry-per-message
    // matches Claude's behavior and is much more readable. Streaming UX
    // could be reintroduced later via an in-place "append to last text
    // entry" mechanism, but that's a UI-level change, not a wire change.
    case "item/agentMessage/delta":
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta":
      break;

    // ---- Mid-conversation compaction ----
    case "thread/compacted": {
      const summary = params?.summary as string | undefined;
      deps.enqueue({ kind: "compacted", summary });
      break;
    }

    // ---- Failure / warnings ----
    case "error": {
      const message = params?.message as string | undefined;
      if (message) deps.enqueue({ kind: "error", message });
      break;
    }
    case "warning":
    case "guardianWarning":
    case "deprecationNotice":
    case "configWarning":
    case "model/rerouted": {
      const text = params?.message as string | undefined;
      if (text) deps.enqueueAuthAwareSystemText(`[${n.method}] ${text}`);
      break;
    }

    // ---- Plan stream ----
    case "item/plan/delta": {
      // Deltas arrive at token granularity; the completed plan item below is
      // the durable card we want in the log.
      break;
    }

    // Everything else (hook/*, fuzzy*, mcpServer/*, thread/realtime/*,
    // account/*, app/*, fs/*, process/*, windows*, externalAgentConfig/*,
    // remoteControl/*, thread/goal/*, rawResponseItem/*, item/auto-
    // ApprovalReview/*, item/commandExecution/outputDelta, etc.): ignored
    // at v1. The "item/...outputDelta" streams could feed richer UI later.
    default:
      break;
  }
}
