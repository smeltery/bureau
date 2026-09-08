import { describe, expect, test } from "bun:test";
import { BACKEND_STOPPED_DURING_TURN, backendFailureMeta, backendStoppedDuringTurn, humanizeBackendFailure } from "./backend-failure-text.ts";

describe("humanizeBackendFailure", () => {
  test("explains SIGTERM, the earlyoom signature", () => {
    const r = humanizeBackendFailure("Claude Code process exited with code 143");
    expect(r.text).toBe("The agent backend was terminated by SIGTERM (exit code 143). The likely cause is the out-of-memory protection on this machine. The conversation is saved and can be resumed.");
    expect(r.raw).toBe("Claude Code process exited with code 143");
    expect(r.id).toBe("sigterm:143");
  });

  test("explains SIGKILL", () => {
    const r = humanizeBackendFailure("Claude Code process exited with code 137");
    expect(r.text).toBe("The agent backend was killed by SIGKILL (exit code 137). The likely cause is the out-of-memory protection on this machine. The conversation is saved and can be resumed.");
    expect(r.id).toBe("sigkill:137");
  });

  test("also matches Codex-style exited (code N)", () => {
    const r = humanizeBackendFailure("codex subprocess exited (code 143) mid-turn");
    expect(r.id).toBe("sigterm:143");
    expect(r.raw).toBe("codex subprocess exited (code 143) mid-turn");
  });

  test("names other signals without guessing at a cause", () => {
    const r = humanizeBackendFailure("process exited with code 130");
    expect(r.text).toBe("The agent backend was stopped by signal 2 (exit code 130). The conversation is saved and can be resumed.");
    expect(r.id).toBe("signal:130");
  });

  test("replaces the harness-internal error_during_execution blob", () => {
    const raw = "Agent stopped: error_during_execution. [ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use";
    const r = humanizeBackendFailure(raw);
    expect(r.text).toBe(BACKEND_STOPPED_DURING_TURN);
    expect(r.text).toBe(backendStoppedDuringTurn());
    expect(r.raw).toBe(raw);
    expect(r.id).toBe("stopped-during-turn");
  });

  test("passes an ordinary exit code through untouched", () => {
    const r = humanizeBackendFailure("Claude Code process exited with code 1");
    expect(r.text).toBe("Claude Code process exited with code 1");
    expect(r.raw).toBeUndefined();
    expect(r.id).toBe("unclassified");
  });

  test("passes an unrecognized failure through untouched", () => {
    for (const raw of ["ECONNRESET", "Invalid API key", "", "process exited with code 200"]) {
      expect(humanizeBackendFailure(raw)).toEqual({ text: raw, id: "unclassified" });
    }
  });
});

describe("backendFailureMeta", () => {
  test("carries the raw diagnostic when the text was rewritten", () => {
    expect(backendFailureMeta(humanizeBackendFailure("Claude Code process exited with code 143"))).toEqual({
      backendFailureRaw: "Claude Code process exited with code 143",
    });
  });

  test("is undefined when nothing was rewritten", () => {
    expect(backendFailureMeta(humanizeBackendFailure("ECONNRESET"))).toBeUndefined();
  });
});

describe("failure identity", () => {
  test("differs for two signals", () => {
    const a = humanizeBackendFailure("process exited with code 130");
    const b = humanizeBackendFailure("process exited with code 131");
    expect(a.id).toBe("signal:130");
    expect(b.id).toBe("signal:131");
    expect(a.id).not.toBe(b.id);
  });
});
