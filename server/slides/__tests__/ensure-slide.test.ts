import { describe, it, expect } from "bun:test";
import { slideContentDigest } from "../../../shared/slide-turns.ts";
import { flush, harness, job, turn } from "./slide-kit.ts";

describe("createSlideMode.ensureSlide", () => {
  it("returns a cached slide (digest matches) without calling the backend", async () => {
    const h = harness();
    h.deck.set("u1", {
      html: "<div>cached</div>",
      placeholder: false,
      errorText: null,
      promptText: "q",
      model: "sonnet",
      createdAt: 1,
      contentDigest: slideContentDigest(turn({ entryId: "u1" })),
    });
    const res = h.ensureSlide("a1", "u1");
    expect(res).toEqual({ status: "ready", slide: h.deck.get("u1")! });
    await flush();
    expect(h.calls).toHaveLength(0);
  });

  it("generates on a miss: pending → writes + broadcasts the slide", async () => {
    const h = harness();
    const res = h.ensureSlide("a1", "u1");
    expect(res).toEqual({ status: "pending" });
    await flush();
    expect(h.calls).toHaveLength(1);
    h.resolveNext("<div>slide</div>");
    await flush();
    expect(h.deck.get("u1")?.html).toBe("<div>slide</div>");
    expect(h.ready).toHaveLength(1);
    expect(h.ready[0].entryId).toBe("u1");
  });

  it("dedupes concurrent requests for the same turn", async () => {
    const h = harness();
    h.ensureSlide("a1", "u1");
    h.ensureSlide("a1", "u1");
    const third = h.ensureSlide("a1", "u1");
    expect(third).toEqual({ status: "pending" });
    await flush();
    expect(h.calls).toHaveLength(1); // one generation, not three
  });

  it("writes a placeholder with no backend call for an empty turn", async () => {
    const h = harness();
    h.setJob("u1", job({ turn: turn({ placeholder: true, assistantText: "", errorText: "boom" }) }));
    h.ensureSlide("a1", "u1");
    await flush();
    expect(h.calls).toHaveLength(0);
    expect(h.deck.get("u1")).toMatchObject({ html: null, placeholder: true, errorText: "boom" });
    expect(h.ready).toHaveLength(1);
  });

  it("drops a result whose conversation root moved on - stale guard", async () => {
    const h = harness();
    h.ensureSlide("a1", "u1");
    await flush();
    h.setRoot("root2"); // a /resume into another thread during generation
    h.resolveNext("<div>late</div>");
    await flush();
    expect(h.deck.has("u1")).toBe(false);
    expect(h.ready).toHaveLength(0);
  });

  it("drops an in-flight result after /clear leaves the agent rootless", async () => {
    // /clear nulls sessionId, so getRootSessionId returns null. The identity
    // guard must treat "no conversation at all" as not-current rather than
    // letting a null match anything.
    const h = harness();
    h.ensureSlide("a1", "u1");
    await flush();
    expect(h.calls).toHaveLength(1);
    h.setRoot(null);
    h.resolveNext("<div>late</div>");
    await flush();
    expect(h.deck.has("u1")).toBe(false);
    expect(h.ready).toHaveLength(0);
  });

  it("a topic rename does NOT drop in-flight slide work", async () => {
    // Slide Mode keys on the conversation ROOT session id, which a manual topic
    // rename doesn't touch, so an in-flight generation still commits. Keying on
    // a topic-generation token (which setTopic bumps) would have wrongly dropped
    // it.
    const h = harness();
    h.ensureSlide("a1", "u1");
    await flush();
    expect(h.calls).toHaveLength(1);
    h.resolveNext("<div>kept</div>"); // root never changed
    await flush();
    expect(h.deck.get("u1")?.html).toBe("<div>kept</div>");
    expect(h.ready).toHaveLength(1);
  });

  it("force regenerates even when cached, threading feedback into the prompt", async () => {
    const h = harness();
    h.deck.set("u1", { html: "<div>old</div>", placeholder: false, errorText: null, promptText: "q", model: "sonnet", createdAt: 1 });
    const res = h.ensureSlide("a1", "u1", { force: true, feedback: "bigger title" });
    expect(res).toEqual({ status: "pending" });
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toContain("bigger title");
    h.resolveNext("<div>new</div>");
    await flush();
    expect(h.deck.get("u1")?.html).toBe("<div>new</div>"); // overwrote
  });

  it("returns unavailable when the turn cannot be resolved", () => {
    const h = harness();
    h.setJob("gone", null);
    expect(h.ensureSlide("a1", "gone")).toEqual({ status: "unavailable" });
  });

  it("a re-request after the conversation root changes starts a fresh job", async () => {
    // Regression: an old-root job in flight must not dedupe a new-root request
    // (the old job is dropped by the stale guard, so the turn would otherwise
    // never generate). Keying the in-flight map by root session id fixes it.
    const h = harness();
    h.ensureSlide("a1", "u1"); // key a1::root1::u1
    await flush();
    expect(h.calls).toHaveLength(1);
    h.setRoot("root2"); // /resume into another thread
    h.ensureSlide("a1", "u1"); // key a1::root2::u1 → NOT deduped
    await flush();
    expect(h.calls).toHaveLength(2); // a live job for the new conversation
    h.resolveNext("<div>old</div>"); // root1 job → dropped by stale guard
    h.resolveNext("<div>new</div>"); // root2 job → written
    await flush();
    expect(h.deck.get("u1")?.html).toBe("<div>new</div>");
    expect(h.ready).toHaveLength(1);
  });

  it("an edit-fork of the in-flight turn leaves no orphan: the turn is gone", async () => {
    // The edit-fork case the root-session guard deliberately does NOT drop on
    // (a fork keeps the root). It doesn't need to: editMessage replays the
    // entries BEFORE the edited one and appends the new text under a NEW entry
    // id, so the forked turn's own id no longer resolves. The in-flight job's
    // commit re-resolves, finds nothing, and discards - no slide is written for
    // a turn that no longer exists, and earlier turns keep matching digests.
    const h = harness();
    h.ensureSlide("a1", "u1");
    await flush();
    expect(h.calls).toHaveLength(1);
    h.setJob("u1", null); // the fork removed this entry id
    h.resolveNext("<div>forked away</div>");
    await flush();
    expect(h.deck.has("u1")).toBe(false);
    expect(h.ready).toHaveLength(0);
  });

  it("coalesces rapid force regens into one rerun with the latest feedback", async () => {
    const h = harness();
    h.ensureSlide("a1", "u1"); // initial, no feedback
    await flush();
    expect(h.calls).toHaveLength(1);
    h.ensureSlide("a1", "u1", { force: true, feedback: "A" }); // queued rerun
    h.ensureSlide("a1", "u1", { force: true, feedback: "B" }); // overwrites A
    await flush();
    expect(h.calls).toHaveLength(1); // no competing writer while gen1 runs
    h.resolveNext("<div>1</div>"); // gen1 done → rerun fires
    await flush();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toContain("B");
    expect(h.calls[1]).not.toContain("A");
    h.resolveNext("<div>2</div>");
    await flush();
  });

  it("caps concurrency at 2 per agent", async () => {
    const h = harness();
    h.ensureSlide("a1", "u1");
    h.ensureSlide("a1", "u2");
    h.ensureSlide("a1", "u3");
    h.ensureSlide("a1", "u4");
    await flush();
    expect(h.concurrentPeak()).toBe(2);
    expect(h.calls).toHaveLength(2); // only 2 running; others queued
    h.resolveNext("<div>1</div>");
    await flush();
    expect(h.calls).toHaveLength(3); // a slot freed → the next starts
  });
});

// --- Reconciliation against live content -------------------------------------

describe("createSlideMode cache reconciliation", () => {
  it("regenerates a stale placeholder whose turn has since gained text", async () => {
    const h = harness();
    // A placeholder cached before the digest field existed, but the live turn
    // now has content (the kit's default turn is "It is 4.").
    h.deck.set("u1", { html: null, placeholder: true, errorText: null, promptText: "q", model: "sonnet", createdAt: 1 });
    const res = h.ensureSlide("a1", "u1");
    expect(res).toEqual({ status: "pending" }); // stale -> regenerate, not served
    await flush();
    expect(h.calls).toHaveLength(1);
    h.resolveNext("<div>real</div>");
    await flush();
    expect(h.deck.get("u1")?.html).toBe("<div>real</div>");
    expect(h.deck.get("u1")?.placeholder).toBe(false);
  });

  it("serves a cached slide whose digest still matches, no regeneration", async () => {
    const h = harness();
    // Generate once so the record carries the current content digest.
    h.ensureSlide("a1", "u1");
    await flush();
    h.resolveNext("<div>v1</div>");
    await flush();
    expect(h.calls).toHaveLength(1);
    // A second ensure for the unchanged turn is served from cache.
    const res = h.ensureSlide("a1", "u1");
    expect(res.status).toBe("ready");
    await flush();
    expect(h.calls).toHaveLength(1); // no second generation
  });

  it("serves a genuine placeholder whose digest matches (no regeneration)", async () => {
    const h = harness();
    const emptyTurn = turn({ placeholder: true, assistantText: "", errorText: null });
    h.setJob("u1", job({ turn: emptyTurn }));
    h.deck.set("u1", {
      html: null,
      placeholder: true,
      errorText: null,
      promptText: emptyTurn.promptText,
      model: "sonnet",
      createdAt: 1,
      contentDigest: slideContentDigest(emptyTurn),
    });
    const res = h.ensureSlide("a1", "u1");
    expect(res.status).toBe("ready"); // digest matches -> served, not regenerated
    await flush();
    expect(h.calls).toHaveLength(0);
  });

  it("regenerates a DIGESTLESS legacy placeholder (unverifiable) with no LLM call", async () => {
    const h = harness();
    h.setJob("u1", job({ turn: turn({ placeholder: true, assistantText: "", errorText: null }) }));
    // Pre-digest record: unverifiable, so it is re-committed (gaining a digest).
    h.deck.set("u1", { html: null, placeholder: true, errorText: null, promptText: "q", model: "sonnet", createdAt: 1 });
    const res = h.ensureSlide("a1", "u1");
    expect(res.status).toBe("pending"); // digestless -> reconcile
    await flush();
    expect(h.calls).toHaveLength(0); // placeholder re-commit needs no backend
    expect(h.deck.get("u1")?.contentDigest).toBeDefined(); // now verifiable
    expect(h.deck.get("u1")?.placeholder).toBe(true);
  });

  it("commit guard discards a result whose content changed under an UNCHANGED root (linked edit-fork)", async () => {
    // The complement of the identity guard, and the case a linked edit-fork
    // would present: the root session id is preserved across the fork, so the
    // identity guard passes it through - the content digest is what rejects it.
    // Identity is the cheap early-out; the digest is the guarantee.
    const h = harness();
    h.ensureSlide("a1", "u1"); // generates from the current turn ("It is 4.")
    await flush();
    expect(h.calls).toHaveLength(1);
    // The turn's content mutates mid-generation: the live digest no longer
    // matches what we generated from, under the SAME rootSessionId.
    h.setJob("u1", job({ turn: turn({ assistantText: "It is FIVE." }) }));
    h.resolveNext("<div>four</div>"); // stale relative to the new content
    await flush();
    expect(h.deck.has("u1")).toBe(false); // discarded, not broadcast
    expect(h.ready).toHaveLength(0);
  });
});
