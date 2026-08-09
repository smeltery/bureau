/**
 * Slide Mode's HTTP surface.
 *
 *   GET  /api/agents/:id/slides            → the conversation's slide map
 *   POST /api/agents/:id/slides/:entryId   → "ensure slide" (cached | pending)
 *
 * Read-scoped exactly like reading the agent's logs (the injected `requireAccess`
 * is that same rule): anyone who can see the chat can read its slides and drive
 * on-demand generation. Generation is fire-and-forget in the manager; the
 * finished slide arrives on the `slide_ready` WS push, so these handlers never
 * block on the model and never emit directly.
 *
 * Unavailability is a 200 PAYLOAD the client branches on — the contextUsage
 * precedent — not an error. Two shapes of it: an agent with no live session
 * answers the deck GET with an empty deck, and a turn that no longer exists
 * answers the ensure POST with `{status:"unavailable"}`. Neither is a failed
 * request, and a 404 for either would make the deck show an error where the
 * truthful answer is "nothing to show yet".
 *
 * Written against an injectable seam (SlideRoutesDeps) so the route layer is
 * testable without the agent manager, systemd, a filesystem or a model — the
 * same pattern as /api/apps. The production wiring lives in
 * ./agent-slides-deps.ts, which imports the seam TYPE from here; nothing in this
 * module reaches for live state.
 */

import type { AuthResult } from "../auth/auth-middleware.ts";
import { agentRouteParts, JSON_HEADERS, readJsonBody } from "./agent-route-helpers.ts";
import type { EnsureSlideReq, EnsureSlideRes, SlideDeckRes } from "../../shared/slides.ts";

export interface SlideRoutesDeps {
  // The auth/room-visibility gate. Returns a Response to refuse, null to allow.
  // Injected rather than imported so a test can allow or deny without standing up
  // users, rooms and tokens; production passes the agent-log rule verbatim.
  requireAccess: (req: Request, auth: AuthResult | undefined, agentId: string) => Response | null;
  // The stored deck for the agent's CURRENT conversation, or null when it has no
  // live session at all.
  getSlideDeck: (agentId: string) => SlideDeckRes | null;
  // Cached-or-start-generating, for one turn. Never awaits the model.
  ensureSlide: (agentId: string, entryId: string, opts?: { force?: boolean; feedback?: string | null }) => EnsureSlideRes;
}

const EMPTY_DECK: SlideDeckRes = { sessionId: null, slides: {} };

export async function handleAgentSlidesRequest(req: Request, url: URL, auth: AuthResult | undefined, deps: SlideRoutesDeps): Promise<Response | null> {
  const parts = agentRouteParts(url.pathname);
  if (!parts || parts.length < 3 || parts[2] !== "slides") return null;
  const agentId = parts[1]!;

  if (req.method === "GET" && parts.length === 3) {
    const denied = deps.requireAccess(req, auth, agentId);
    if (denied) return denied;
    // No live session yet → an empty deck rather than an error.
    return json(deps.getSlideDeck(agentId) ?? EMPTY_DECK);
  }

  if (req.method === "POST" && parts.length === 4) {
    const denied = deps.requireAccess(req, auth, agentId);
    if (denied) return denied;
    const body = ((await readJsonBody(req)) ?? {}) as Partial<EnsureSlideReq>;
    // Both fields are narrowed rather than validated: a malformed `force` is a
    // plain request and malformed `feedback` is no feedback. There is nothing a
    // caller can express here that is worth refusing a slide over.
    const force = body.force === true;
    const feedback = typeof body.feedback === "string" ? body.feedback : null;
    return json(deps.ensureSlide(agentId, parts[3]!, { force, feedback }));
  }

  return null;
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { headers: JSON_HEADERS });
}
