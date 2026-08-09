// The client cannot tell a failed generation from a slow one, so the server has
// to say so - that is the whole reason the slide_failed signal exists.

import { describe, it, expect } from "bun:test";
import { flush, harness } from "./slide-kit.ts";

describe("createSlideMode failure reporting", () => {
  // The reason crossing the wire is a CLOSED code, never the underlying error:
  // slide_failed reaches every session that can see the room, and backend
  // exception text / raw model output is neither stable nor ours to broadcast.
  it("reports a formatter error as generation_failed, with no slide written", async () => {
    const h = harness();
    h.ensureSlide("a1", "u1");
    await flush();
    h.rejectNext("backend exploded: /home/someone/.creds not readable");
    await flush();
    expect(h.deck.get("u1")).toBeUndefined();
    expect(h.ready).toHaveLength(0);
    expect(h.failed).toHaveLength(1);
    expect(h.failed[0].entryId).toBe("u1");
    expect(h.failed[0].reason).toBe("generation_failed");
  });

  it("reports output that violates the slide contract as invalid_output", async () => {
    const h = harness();
    h.ensureSlide("a1", "u1");
    await flush();
    h.resolveNext("<div><script>alert(1)</script></div>");
    await flush();
    expect(h.deck.get("u1")).toBeUndefined();
    expect(h.failed).toHaveLength(1);
    // Not the validator's message, which quotes the model's raw output.
    expect(h.failed[0].reason).toBe("invalid_output");
  });

  it("stays SILENT when the result was discarded, not failed", async () => {
    // /clear during generation: the write is dropped by the identity guard, and
    // the turn's deck position is gone too - so there is nothing to report a
    // failure about. Announcing one would show a fallback for a turn that no
    // longer exists.
    const h = harness();
    h.ensureSlide("a1", "u1");
    await flush();
    h.setRoot(null);
    h.rejectNext("backend exploded");
    await flush();
    expect(h.failed).toHaveLength(0);
  });

  it("stays SILENT for a failed pass that has a rerun queued behind it", async () => {
    // The race: a ↻ arrives mid-generation and coalesces into a rerun; then pass
    // A fails and pass B succeeds. Reporting A would flash the fallback on a
    // slide already being retried - only the LAST pass's outcome is terminal.
    // Expect: no failure at all, and exactly one slide_ready.
    const h = harness();
    h.ensureSlide("a1", "u1");
    await flush();
    h.ensureSlide("a1", "u1", { force: true }); // coalesced rerun
    h.rejectNext("first pass exploded");
    await flush();
    expect(h.failed).toHaveLength(0);
    expect(h.calls).toHaveLength(2); // the rerun ran
    h.resolveNext("<div>retry worked</div>");
    await flush();
    expect(h.failed).toHaveLength(0);
    expect(h.ready).toHaveLength(1);
    expect(h.deck.get("u1")?.html).toBe("<div>retry worked</div>");
  });

  it("reports the LAST pass's failure when the rerun fails too", async () => {
    const h = harness();
    h.ensureSlide("a1", "u1");
    await flush();
    h.ensureSlide("a1", "u1", { force: true });
    h.rejectNext("first pass exploded");
    await flush();
    h.rejectNext("rerun exploded too");
    await flush();
    expect(h.failed).toHaveLength(1); // once, not once per pass
    expect(h.failed[0].reason).toBe("generation_failed");
  });
});
