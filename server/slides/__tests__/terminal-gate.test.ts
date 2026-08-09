// Terminal gate + deferred fulfilment: a slide is generated only for a SETTLED
// turn, and a request parked while the turn was in flight is always fulfilled
// when it settles (never orphaned, never a placeholder written over a live turn).

import { describe, it, expect } from "bun:test";
import { drainOnSettle } from "../generate.ts";
import { deferred, flush, harness, job, turn } from "./slide-kit.ts";

describe("createSlideMode terminal gate", () => {
  it("gates a non-terminal turn: pending, NO generation, NO placeholder written", async () => {
    const h = harness();
    h.setTerminal("u1", false); // the still-running newest turn
    const res = h.ensureSlide("a1", "u1");
    expect(res).toEqual({ status: "pending" });
    await flush();
    expect(h.calls).toHaveLength(0); // never formats a half-streamed answer
    expect(h.deck.has("u1")).toBe(false); // and never records a stale placeholder
    expect(h.ready).toHaveLength(0);
  });

  it("onTurnSettled fulfils a parked request: generates the settled slide", async () => {
    const h = harness();
    h.setTerminal("u1", false);
    h.ensureSlide("a1", "u1"); // parks a waiter, pending
    await flush();
    expect(h.calls).toHaveLength(0);
    // Turn completes with content.
    h.setTerminal("u1", true);
    h.onTurnSettled("a1", "u1");
    await flush();
    expect(h.calls).toHaveLength(1); // now it generates
    h.resolveNext("<div>answer</div>");
    await flush();
    expect(h.deck.get("u1")?.html).toBe("<div>answer</div>");
    expect(h.ready).toHaveLength(1);
  });

  it("onTurnSettled on an empty turn commits a placeholder (deck stays 1:1)", async () => {
    const h = harness();
    const emptyTurn = turn({ placeholder: true, assistantText: "", errorText: null });
    h.setJob("u1", job({ turn: emptyTurn, terminal: false }));
    h.ensureSlide("a1", "u1"); // parked while in flight
    await flush();
    expect(h.deck.has("u1")).toBe(false);
    // Interrupted/tool-only -> terminal, still empty.
    h.setJob("u1", job({ turn: emptyTurn, terminal: true }));
    h.onTurnSettled("a1", "u1");
    await flush();
    expect(h.calls).toHaveLength(0); // placeholder needs no backend call
    expect(h.deck.get("u1")).toMatchObject({ html: null, placeholder: true });
    expect(h.ready).toHaveLength(1);
  });

  it("onTurnSettled without a parked request does nothing (view-driven cost)", async () => {
    const h = harness();
    h.onTurnSettled("a1", "u1"); // nobody asked while it was in flight
    await flush();
    expect(h.calls).toHaveLength(0);
    expect(h.deck.has("u1")).toBe(false);
    expect(h.ready).toHaveLength(0);
  });

  it("preserves the latest feedback a client parked while the turn was gated", async () => {
    const h = harness();
    h.setTerminal("u1", false);
    h.ensureSlide("a1", "u1", { force: true, feedback: "make it teal" });
    h.ensureSlide("a1", "u1", { force: true, feedback: "bigger title" }); // latest wins
    await flush();
    expect(h.calls).toHaveLength(0); // still gated
    h.setTerminal("u1", true);
    h.onTurnSettled("a1", "u1");
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toContain("bigger title");
    expect(h.calls[0]).not.toContain("make it teal");
  });

  it("force parked while gated stays sticky; a later plain prefetch doesn't clobber it", async () => {
    const h = harness();
    h.setTerminal("u1", false);
    h.ensureSlide("a1", "u1", { force: true, feedback: "teal" }); // forced ↻
    h.ensureSlide("a1", "u1"); // plain neighbor prefetch - must NOT drop force/feedback
    await flush();
    h.setTerminal("u1", true);
    h.onTurnSettled("a1", "u1");
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toContain("teal"); // force + feedback survived
  });

  it("onTurnSettled drops the parked request when the turn is gone (e.g. /clear)", async () => {
    const h = harness();
    h.setTerminal("u1", false);
    h.ensureSlide("a1", "u1"); // parked
    await flush();
    h.setJob("u1", null); // conversation cleared: the turn no longer resolves
    h.onTurnSettled("a1", "u1");
    await flush();
    expect(h.calls).toHaveLength(0); // nothing to show; dropped, not orphaned
    expect(h.deck.has("u1")).toBe(false);
  });
});

describe("drainOnSettle (universal turn-settled drain)", () => {
  it("fires onSettled with the anchor when the turn promise RESOLVES", async () => {
    const seen: string[] = [];
    const d = deferred<void>();
    drainOnSettle(
      d.promise,
      () => "u1",
      (e) => seen.push(e),
    );
    d.resolve();
    await flush();
    expect(seen).toEqual(["u1"]);
  });

  it("fires onSettled when the turn promise REJECTS (error/swap/kill path)", async () => {
    const seen: string[] = [];
    const d = deferred<void>();
    drainOnSettle(
      d.promise,
      () => "u1",
      (e) => seen.push(e),
    );
    d.reject(new Error("session swapped"));
    await flush();
    expect(seen).toEqual(["u1"]); // reject still drains, no unhandled rejection
  });

  it("reads the anchor AT settle time and no-ops when it is null", async () => {
    const seen: string[] = [];
    let anchor: string | null = null;
    const d = deferred<void>();
    drainOnSettle(
      d.promise,
      () => anchor,
      (e) => seen.push(e),
    );
    anchor = "u9"; // stamped after wiring, before settle (as addLogEntry does)
    d.resolve();
    await flush();
    expect(seen).toEqual(["u9"]);

    const seen2: string[] = [];
    const d2 = deferred<void>();
    drainOnSettle(
      d2.promise,
      () => null, // a turn with no user_message anchor
      (e) => seen2.push(e),
    );
    d2.resolve();
    await flush();
    expect(seen2).toEqual([]);
  });

  it("drains a gated request end-to-end: gate -> settle -> generate once", async () => {
    // The real wiring: ensure while non-terminal parks a waiter and generates
    // nothing; settling the turn promise via drainOnSettle invokes onTurnSettled
    // which generates exactly once.
    const h = harness();
    h.setTerminal("u1", false);
    h.ensureSlide("a1", "u1"); // gated -> parked
    await flush();
    expect(h.calls).toHaveLength(0);

    const record = { anchorEntryId: "u1" as string | null };
    const d = deferred<void>();
    drainOnSettle(
      d.promise,
      () => record.anchorEntryId,
      (e) => {
        h.setTerminal("u1", true); // turn is now terminal at settle
        h.onTurnSettled("a1", e);
      },
    );
    d.resolve();
    await flush();
    expect(h.calls).toHaveLength(1); // generated exactly once on settle
  });
});
