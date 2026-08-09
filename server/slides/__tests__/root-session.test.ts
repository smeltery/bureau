// The deck's storage key and the conversation identity the stale guard uses.
// The walk is pure (the fork chain is injected), so no session file is touched.

import { describe, it, expect } from "bun:test";
import { getRootSessionId, rootSessionIdFrom, type ForkChain } from "../root-session.ts";

describe("rootSessionIdFrom", () => {
  it("returns the leaf itself when the conversation was never forked", () => {
    expect(rootSessionIdFrom({}, "s1")).toBe("s1");
    expect(rootSessionIdFrom({ s1: {} }, "s1")).toBe("s1");
  });

  it("walks a fork chain to its root, so every branch shares one deck", () => {
    // s3 forked from s2, which forked from s1: an edit-fork adds a leaf but
    // keeps the conversation's root.
    const chain: ForkChain = { s3: { forkedFrom: "s2" }, s2: { forkedFrom: "s1" }, s1: {} };
    expect(rootSessionIdFrom(chain, "s3")).toBe("s1");
    expect(rootSessionIdFrom(chain, "s2")).toBe("s1");
    expect(rootSessionIdFrom(chain, "s1")).toBe("s1");
  });

  it("a /resume into an unrelated thread yields a DIFFERENT root (the stale signal)", () => {
    const chain: ForkChain = { s2: { forkedFrom: "s1" }, other: {} };
    expect(rootSessionIdFrom(chain, "s2")).toBe("s1");
    expect(rootSessionIdFrom(chain, "other")).toBe("other");
  });

  it("terminates on a corrupt cycle instead of hanging", () => {
    // a -> b -> a: the walk stops the moment it revisits an id, landing back on
    // the entry point. Any fixed member of the cycle is fine as a deck key; what
    // matters is that it terminates and is stable for the same leaf.
    expect(rootSessionIdFrom({ a: { forkedFrom: "b" }, b: { forkedFrom: "a" } }, "a")).toBe("a");
    expect(rootSessionIdFrom({ a: { forkedFrom: "a" } }, "a")).toBe("a");
  });
});

describe("getRootSessionId", () => {
  it("is null for an agent with no conversation at all (post-/clear)", () => {
    // No leaf session -> no deck to key, and nothing an in-flight result could
    // still belong to. Reads no file, so this is safe against the real state.
    expect(getRootSessionId("a1", null)).toBeNull();
    expect(getRootSessionId("a1", undefined)).toBeNull();
    expect(getRootSessionId("a1", "")).toBeNull();
  });
});
