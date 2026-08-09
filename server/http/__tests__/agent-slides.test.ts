import { beforeEach, describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleAgentSlidesRequest, type SlideRoutesDeps } from "../agent-slides.ts";
import type { EnsureSlideRes, SlideDeckRes, SlideRecord } from "../../../shared/slides.ts";

// The route layer only: every collaborator is injected, so no agent manager, no
// filesystem, no model. What is under test is the contract the deck depends on —
// which shapes come back, when a 200 carries "nothing to show", and that the
// access rule is consulted BEFORE anything is read or generated.

const ownerAuth: AuthResult = {
  kind: "ok",
  session: { sessionIdHash: "hash", sessionPrefix: "sess", userId: "user-1", username: "Ada", role: "owner", needsRolling: false, absoluteExpiresAt: Date.now() + 86_400_000 },
};

const slide: SlideRecord = {
  html: "<section>4</section>",
  placeholder: false,
  errorText: null,
  promptText: "What is 2+2?",
  model: "sonnet",
  createdAt: 1000,
  contentDigest: "abcdef0123456789",
};

let calls: string[];
let deck: SlideDeckRes | null;
let ensureResult: EnsureSlideRes;
let denial: Response | null;
let deps: SlideRoutesDeps;

beforeEach(() => {
  calls = [];
  deck = { sessionId: "root-1", slides: { u1: slide } };
  ensureResult = { status: "pending" };
  denial = null;
  deps = {
    requireAccess: (_req, _auth, agentId) => {
      calls.push(`requireAccess:${agentId}`);
      return denial;
    },
    getSlideDeck: (agentId) => {
      calls.push(`getSlideDeck:${agentId}`);
      return deck;
    },
    ensureSlide: (agentId, entryId, opts) => {
      calls.push(`ensureSlide:${agentId}:${entryId}:force=${opts?.force}:feedback=${JSON.stringify(opts?.feedback)}`);
      return ensureResult;
    },
  };
});

async function call(method: string, path: string, body?: unknown, auth: AuthResult | undefined = ownerAuth) {
  const request = new Request(`http://local.test${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const res = await handleAgentSlidesRequest(request, new URL(request.url), auth, deps);
  return { res, status: res?.status ?? 0, body: res ? await res.json() : null };
}

describe("slide routes: the deck", () => {
  test("GET answers the conversation's slide map", async () => {
    const { status, body } = await call("GET", "/api/agents/a1/slides");

    expect(status).toBe(200);
    expect(body).toEqual({ sessionId: "root-1", slides: { u1: slide } });
    expect(calls).toEqual(["requireAccess:a1", "getSlideDeck:a1"]);
  });

  // The whole point of the empty-deck answer: an agent between conversations is
  // not an error, and a 404 here would show the deck an error state on a brand
  // new agent.
  test("an agent with no live session answers an EMPTY deck, 200, not an error", async () => {
    deck = null;

    const { status, body } = await call("GET", "/api/agents/a1/slides");

    expect(status).toBe(200);
    expect(body).toEqual({ sessionId: null, slides: {} });
  });

  test("the unprefixed /agents path reaches the same handler", async () => {
    const { status, body } = await call("GET", "/agents/a1/slides");

    expect(status).toBe(200);
    expect(body.sessionId).toBe("root-1");
  });
});

describe("slide routes: ensure", () => {
  test("a cached slide comes back ready, in one round trip", async () => {
    ensureResult = { status: "ready", slide };

    const { status, body } = await call("POST", "/api/agents/a1/slides/u1");

    expect(status).toBe(200);
    expect(body).toEqual({ status: "ready", slide });
  });

  // The route must not block on the model: a miss answers pending and the slide
  // arrives later on the slide_ready push.
  test("a miss answers pending without waiting for generation", async () => {
    const { status, body } = await call("POST", "/api/agents/a1/slides/u1");

    expect(status).toBe(200);
    expect(body).toEqual({ status: "pending" });
  });

  test("a turn that is gone answers unavailable as a 200 payload", async () => {
    ensureResult = { status: "unavailable" };

    const { status, body } = await call("POST", "/api/agents/a1/slides/u9");

    expect(status).toBe(200);
    expect(body).toEqual({ status: "unavailable" });
  });

  test("force and feedback ride through from the body", async () => {
    await call("POST", "/api/agents/a1/slides/u1", { force: true, feedback: "less text" });

    expect(calls).toContain('ensureSlide:a1:u1:force=true:feedback="less text"');
  });

  // A malformed body is a plain request, not a refusal: there is nothing here
  // worth denying someone a slide over.
  test("a missing body is a plain unforced request", async () => {
    await call("POST", "/api/agents/a1/slides/u1");

    expect(calls).toContain("ensureSlide:a1:u1:force=false:feedback=null");
  });

  test("non-string feedback and non-true force are ignored, not refused", async () => {
    await call("POST", "/api/agents/a1/slides/u1", { force: "yes", feedback: 42 });

    expect(calls).toContain("ensureSlide:a1:u1:force=false:feedback=null");
  });

  // The entry id is taken from the path VERBATIM, like every sibling agent route
  // (queue ids, message entry ids). Bureau log ids are server-generated from a
  // path-safe charset, so there is nothing to decode; an id that somehow did not
  // match a live turn answers `unavailable` rather than erroring.
  test("the entry id reaches the manager exactly as it appeared in the path", async () => {
    await call("POST", "/api/agents/a1/slides/log-1755-ab3f");

    expect(calls).toContain("ensureSlide:a1:log-1755-ab3f:force=false:feedback=null");
  });
});

describe("slide routes: access", () => {
  test("a refusal from the access rule stops the read", async () => {
    denial = new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });

    const { status } = await call("GET", "/api/agents/a1/slides");

    expect(status).toBe(403);
    expect(calls).toEqual(["requireAccess:a1"]);
  });

  // The gate has to run before generation, not just before the answer — a
  // fire-and-forget generation spends a model call whether or not the caller
  // ever sees it.
  test("a refusal stops generation from starting", async () => {
    denial = new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });

    const { status } = await call("POST", "/api/agents/a1/slides/u1");

    expect(status).toBe(403);
    expect(calls).toEqual(["requireAccess:a1"]);
  });
});

describe("slide routes: fall-through", () => {
  test("unrelated agent routes are not claimed", async () => {
    expect((await call("GET", "/api/agents/a1/logs")).res).toBeNull();
    expect((await call("GET", "/api/apps")).res).toBeNull();
    // The deck is GET-only and ensure is POST-only; the wrong verb falls through
    // rather than 405ing, so a future route on the same path can claim it.
    expect((await call("POST", "/api/agents/a1/slides")).res).toBeNull();
    expect((await call("GET", "/api/agents/a1/slides/u1")).res).toBeNull();
    // Nothing deeper than one entry id exists.
    expect((await call("POST", "/api/agents/a1/slides/u1/extra")).res).toBeNull();
  });
});
