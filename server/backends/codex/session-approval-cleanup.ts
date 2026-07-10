import { mapApprovalDecision } from "./approvals.ts";
import type { JsonRpcLiteClient } from "./client.ts";
import type { PendingApproval } from "./session-requests.ts";

export function resolvePendingApprovalsOnAbort(pendingApprovals: Map<string, PendingApproval>): void {
  // Release any in-flight server-initiated approval requests so the parked
  // JsonRpcLiteClient handler frames don't leak across to the next turn.
  // close() can use respondWithError because client.close() runs synchronously
  // right after and short-circuits the deferred-rejection's auto-respond — the
  // hot-abort path doesn't close the client, so we must resolve cleanly to
  // avoid double-responding on the wire (one -32000, then a -32603 from the
  // catch in JsonRpcLiteClient.handleServerRequest). Routing through
  // mapApprovalDecision keeps the wire shape identical to a user-driven deny.
  for (const [, pending] of pendingApprovals) {
    try {
      const decisionWire = mapApprovalDecision(pending.method, {
        kind: "deny",
        reason: "Turn interrupted",
      });
      pending.resolve({ decision: decisionWire });
    } catch {}
  }
  pendingApprovals.clear();
}

export function rejectPendingApprovalsOnClose(client: JsonRpcLiteClient, pendingApprovals: Map<string, PendingApproval>): void {
  // Tell codex about in-flight approvals before tearing down. Respond on
  // the wire FIRST: the deferred rejection below would also trigger an
  // auto-respond, but by the time that fires we've called client.close()
  // and the response is dropped — so the explicit respondWithError is what
  // codex actually sees. Then reject the deferred so the parked handler
  // frame unwinds and the promise frees.
  for (const [, pending] of pendingApprovals) {
    try {
      client.respondWithError(pending.jsonRpcId, -32000, "Session closed");
    } catch {}
    try {
      pending.reject(new Error("Session closed"));
    } catch {}
  }
  pendingApprovals.clear();
}
