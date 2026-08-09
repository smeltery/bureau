// Answering one in-flight codex approval with the user's decision.
//
// Split out of CodexSession so the wire response and the session-scoped rule
// bookkeeping sit together in one readable place.

import type { ApprovalDecision, NormalizedEvent } from "../types.ts";
import { mapApprovalDecision } from "./approvals.ts";
import { applyAllowPrefix } from "./prefix-rule-notices.ts";
import type { SessionPrefixRules } from "./prefix-rules.ts";
import type { PendingApproval } from "./session-requests.ts";

export interface AnswerApprovalOpts {
  pendingApprovals: Map<string, PendingApproval>;
  prefixRules: SessionPrefixRules;
  approvalId: string;
  decision: ApprovalDecision;
  enqueue: (event: NormalizedEvent) => void;
}

export function answerPendingApproval(opts: AnswerApprovalOpts): void {
  const pending = opts.pendingApprovals.get(opts.approvalId);
  if (!pending) return;
  opts.pendingApprovals.delete(opts.approvalId);
  // "Allow, and stop asking about this prefix" is applied here rather than on
  // the wire: we record the rule ourselves and answer codex with a plain
  // one-shot allow. Handing codex its own `acceptWithExecpolicyAmendment` back
  // would make it write the rule to $CODEX_HOME/rules/default.rules —
  // permanent, and shared with every other codex agent on the box.
  if (opts.decision.kind === "allow_prefix") {
    applyAllowPrefix(opts.prefixRules, pending, opts.decision.prefixText, opts.enqueue);
  }
  const decisionWire = mapApprovalDecision(pending.method, opts.decision);
  // Resolving the deferred releases the JsonRpcLiteClient's handler-chain
  // await; the client auto-responds with this payload. (Previously we called
  // client.respond() directly while leaving the promise pending, which leaked
  // one parked handler frame per approval.) The enum variant set differs per
  // method — see mapApprovalDecision for the routing.
  pending.resolve({ decision: decisionWire });
}
