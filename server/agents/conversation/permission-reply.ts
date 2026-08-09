// Reading a reply to the auto-mode permission prompt.
//
// The prompt is answered in plain chat, and every reply that isn't a
// recognized option is treated as a DENIAL with that text as the reason. So
// the boundary here is load-bearing in both directions: "4 rg --files" must be
// read as an allow (denying it would be baffling), and near-misses like "42"
// or "4x" must NOT be, or a typo would silently widen what an agent may run.

import type { AgentState } from "../../../shared/types.ts";
import type { ApprovalDecision } from "../../backends/types.ts";

export interface PermissionReplyOutcome {
  decision: ApprovalDecision;
  // Where the agent goes as the turn is handed back. Allow → tool_executing
  // (the blocked tool is about to run); deny → thinking (the model resumes to
  // handle the denial).
  resumeState: AgentState;
  // Ephemeral system line to log before the decision is sent, or null when the
  // backend is the one that reports what happened (option 4: only the backend
  // knows which rule it actually stored, or why it refused one).
  note: string | null;
}

// Read a reply to option 4 of the permission prompt: bare "4" (take the rule
// the backend proposed) or "4 <prefix>" (cover this much of the command
// instead). Anything else returns null and is handled by the other branches —
// notably "4x" or "42", which are NOT option 4.
//
// The prefix is returned as the raw text the user typed. Splitting it into
// command tokens is the backend's job: it owns what a token is, and it is the
// one that checks the prefix against the command actually being approved.
export function parsePrefixAllowReply(trimmed: string): { prefixText: string } | null {
  if (trimmed === "4") return { prefixText: "" };
  const m = /^4\s+(\S.*)$/.exec(trimmed);
  if (!m) return null;
  return { prefixText: m[1].trim() };
}

export function resolvePermissionReply(text: string, allowPrefixLabel: string | undefined): PermissionReplyOutcome {
  const trimmed = text.trim();
  // Parsed before the branches below so a reply of "4 rg --files" isn't read as
  // free text (which would deny with that as the reason).
  const prefixReply = parsePrefixAllowReply(trimmed);
  if (trimmed === "1") {
    return { decision: { kind: "allow_persistent" }, resumeState: "tool_executing", note: "Permission granted (rule added for this session)." };
  }
  if (trimmed === "2") {
    return { decision: { kind: "allow_once" }, resumeState: "tool_executing", note: "Permission granted (once)." };
  }
  if (prefixReply && allowPrefixLabel) {
    // Guarded on allowPrefixLabel: when no 4th option was offered, "4" is not a
    // choice the user could have read, so it falls through to the
    // deny-with-reason branch like any other unrecognized reply.
    //
    // No confirmation line here on purpose — the backend owns the rule and
    // emits one message saying what it actually remembered, including the case
    // where a typed prefix is refused for not matching the command. A prefix
    // the backend rejects is therefore still an allow-once for THIS call, never
    // a deny of some other shape.
    return {
      decision: { kind: "allow_prefix", ...(prefixReply.prefixText ? { prefixText: prefixReply.prefixText } : {}) },
      resumeState: "tool_executing",
      note: null,
    };
  }
  if (trimmed === "3") {
    return { decision: { kind: "deny", reason: "User denied." }, resumeState: "thinking", note: "Permission denied." };
  }
  return { decision: { kind: "deny", reason: text }, resumeState: "thinking", note: "Permission denied with reason forwarded to agent." };
}
