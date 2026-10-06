import type { ApiTokenWire } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import { addLogEntry } from "../agents/state.ts";
import type { AuthResult } from "./auth-middleware.ts";
import { getUserByName } from "../users.ts";
import { API_TOKEN_EXPIRY_DAYS, drainApiTokenInbox, enqueueApiTokenInboxMessage, listApiTokens, mintApiToken, revokeApiToken } from "./api-tokens.ts";
import { apiTokenIdempotency, cachedJson, idempotencyToResponse, readIdempotencyKey } from "../http/idempotency.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const CORS_ALLOW_HEADERS = "Authorization, Content-Type, Idempotency-Key";

export async function handleApiTokensRequest(req: Request, url: URL, auth: AuthResult | undefined): Promise<Response | null> {
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/api-tokens")) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
      },
    });
  }
  if (req.method === "OPTIONS" && (url.pathname.startsWith("/api/api-token-inboxes") || url.pathname === "/api/me/api-token-inbox/drain")) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
      },
    });
  }

  const inboxSendMatch = /^\/api\/api-token-inboxes\/([^/]+)\/messages$/.exec(url.pathname);
  if (inboxSendMatch && req.method === "POST") {
    const agentToken = resolveAgentToken(readBearerToken(req));
    if (!agentToken) return jsonError(401, "missing or invalid bearer token");
    const sender = AgentManager.getAgent(agentToken.agentId);
    const display = AgentManager.getAgentDisplay(agentToken.agentId);
    if (!sender?.userId || !display) return jsonError(403, "forbidden");
    const rawBody = await req.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody || "{}") as Record<string, unknown>;
    } catch {
      return jsonError(400, "invalid JSON");
    }
    const text = typeof body.text === "string" ? body.text : "";
    if (!text) return jsonError(400, "text is required");
    const tokenId = decodeURIComponent(inboxSendMatch[1]!);
    const outcome = await apiTokenIdempotency.run({ subject: `agent:${agentToken.agentId}`, op: "api-token-inbox-send", idempotencyKey: readIdempotencyKey(req), rawBody }, async () => {
      const result = await enqueueApiTokenInboxMessage({
        tokenId,
        userId: sender.userId!,
        text,
        senderAgentId: agentToken.agentId,
        senderAgentName: display.name,
        senderRoomName: display.roomName,
      });
      if (!result.ok) return cachedJson(404, { error: "api token unavailable" });
      addLogEntry(agentToken.agentId, "api_token_outbound", text, {
        recipient_api_token_name: result.tokenName,
      });
      return cachedJson(200, { messageId: result.message.id, lastDrainedAt: result.lastDrainedAt });
    });
    return idempotencyToResponse(outcome);
  }

  if (url.pathname === "/api/me/api-token-inbox/drain" && req.method === "POST") {
    if (auth?.kind !== "api") return jsonError(401, "api token required");
    const rawBody = await req.text();
    let after = 0;
    if (rawBody.trim()) {
      try {
        const body = JSON.parse(rawBody) as Record<string, unknown>;
        if (body.after !== undefined) {
          if (!Number.isSafeInteger(body.after) || (body.after as number) < 0) return jsonError(400, "invalid_after");
          after = body.after as number;
        }
      } catch {
        return jsonError(400, "invalid JSON");
      }
    }
    const outcome = await apiTokenIdempotency.run(
      { subject: `api:${auth.token.tokenId}`, op: "api-token-inbox-drain", idempotencyKey: readIdempotencyKey(req), rawBody: rawBody || "{}" },
      async () => {
        const drained = await drainApiTokenInbox(auth.token.tokenId, Date.now(), after);
        return drained ? cachedJson(200, drained) : cachedJson(404, { error: "api token unavailable" });
      },
    );
    return idempotencyToResponse(outcome);
  }

  const memberMatch = /^\/api\/users\/([^/]+)\/api-tokens(?:\/([^/]+))?$/.exec(url.pathname);
  if (memberMatch && (req.method === "GET" || req.method === "DELETE")) {
    if (auth?.kind !== "ok") return jsonError(401, "authenticated session required");
    if (auth.session.role !== "owner") return jsonError(403, "owner only");
    const member = getUserByName(decodeURIComponent(memberMatch[1]!));
    if (!member) return jsonError(404, "user not found");
    const tokenId = memberMatch[2] ? decodeURIComponent(memberMatch[2]) : null;
    if (req.method === "GET" && !tokenId) return json({ apiTokens: listApiTokens(member.id) });
    if (req.method === "DELETE" && tokenId) {
      if (!(await revokeApiToken(member.id, tokenId))) return jsonError(404, "API token not found");
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }
    return jsonError(404, "not found");
  }

  if (!url.pathname.startsWith("/api/api-tokens")) return null;
  if (auth?.kind !== "ok") return jsonError(401, "authenticated session required");

  if (url.pathname === "/api/api-tokens" && req.method === "GET") {
    return json({ apiTokens: listApiTokens(auth.session.userId) });
  }

  if (url.pathname === "/api/api-tokens" && req.method === "POST") {
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 64) return jsonError(422, "name must be between 1 and 64 characters");
    const expiresInDays = body.expiresInDays;
    if (!(API_TOKEN_EXPIRY_DAYS as readonly unknown[]).includes(expiresInDays)) {
      return jsonError(422, "expiresInDays must be 30, 365, or null");
    }
    return json(await mintApiToken({ userId: auth.session.userId, name, expiresInDays: expiresInDays as number | null }), 201);
  }

  const match = /^\/api\/api-tokens\/([^/]+)$/.exec(url.pathname);
  if (match && req.method === "DELETE") {
    if (!(await revokeApiToken(auth.session.userId, decodeURIComponent(match[1]!)))) return jsonError(404, "API token not found");
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  return jsonError(404, "not found");
}

function json(body: Record<string, unknown> | { apiTokens: ApiTokenWire[] } | { token: string; apiToken: ApiTokenWire }, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "invalid JSON");
  }
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}
