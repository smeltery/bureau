// GET /api/agents/:id/avatar.svg: the agent's office figure as a standalone
// SVG image, so apps and pages can show who an agent is with a plain <img>.
// The server renders the same Character component the office draws, so the
// image cannot drift from the agent's look in the office.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentOutfit } from "../../shared/types.ts";
import { Character } from "../../ui/office/scene/Character.tsx";
import * as AgentManager from "../agent-manager.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { agentRouteParts, jsonError, requireLiveAgentReadAccess } from "./agent-route-helpers.ts";

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';

export function agentAvatarSvg(outfit: AgentOutfit): string {
  // The working pose is the neutral standing figure; idle sleeps and the
  // other states raise a hand or an alert, which read oddly as a portrait.
  const markup = renderToStaticMarkup(createElement(Character, { state: "thinking", outfit }));
  // React omits the namespace inside a page; a standalone image needs it.
  return markup.startsWith("<svg ") ? `<svg ${SVG_NS} ${markup.slice(5)}` : markup;
}

// Members who can see the agent's room, the agent's own bearer, and bearers
// acting for such a member may read it.
export function handleAgentAvatarRequest(req: Request, url: URL, auth: AuthResult | undefined): Response | null {
  const parts = agentRouteParts(url.pathname);
  if (req.method !== "GET" || parts?.length !== 3 || parts[0] !== "agents" || parts[2] !== "avatar.svg") return null;
  const agentId = parts[1]!;
  const denied = requireLiveAgentReadAccess(req, auth, agentId);
  if (denied) return denied;
  const agent = AgentManager.getAgent(agentId);
  return agent ? agentAvatarResponse(req, agent.outfit) : jsonError(404, "agent not found");
}

function agentAvatarResponse(req: Request, outfit: AgentOutfit): Response {
  const svg = agentAvatarSvg(outfit);
  const etag = `W/"${Bun.hash(svg).toString(36)}"`;
  const headers = {
    ETag: etag,
    // Outfits change, so revalidate every time; a match is a cheap 304.
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    // An SVG opened as a page could run script. This one has none and React
    // escapes the outfit's strings; the policy is a second fence.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  };
  const ifNoneMatch = req.headers.get("If-None-Match");
  if (ifNoneMatch && ifNoneMatch.split(",").some((tag) => tag.trim() === etag || tag.trim() === "*")) return new Response(null, { status: 304, headers });
  return new Response(svg, { headers: { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" } });
}
