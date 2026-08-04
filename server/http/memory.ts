import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { isSafeScopeId, memoryStore } from "../memory-store.ts";
import { getUserById, listUsers } from "../users.ts";
import type { MemoryScope } from "../../shared/types.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function error(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: { code, message, ...(extra ?? {}) } }, status);
}

function parseScope(raw: unknown): MemoryScope | null {
  return raw === "office" || raw === "room" || raw === "agent" || raw === "boss" ? raw : null;
}

function resolveTarget(scope: MemoryScope | null, rawScopeId: unknown, bearer: AgentMemoryIdentity | null, auth: AuthResult | undefined): { scope: MemoryScope; scopeId: string | null } | Response {
  if (!scope) return error(400, "unsupported_scope", "scope must be office, room, agent, or boss");

  if (scope === "office") {
    if (rawScopeId !== undefined && rawScopeId !== null && rawScopeId !== "") {
      return error(400, "invalid_scope_id", "office memory takes no scopeId");
    }
    return { scope, scopeId: null };
  }

  if ((rawScopeId === undefined || rawScopeId === null || rawScopeId === "") && scope === "agent" && bearer) {
    return { scope, scopeId: bearer.agentId };
  }

  if ((rawScopeId === undefined || rawScopeId === null || rawScopeId === "") && scope === "boss") {
    const userId = bearer?.userId ?? (auth?.kind === "ok" ? auth.session.userId : null);
    if (userId) return { scope, scopeId: userId };
    return error(400, "invalid_scope_id", "boss memory requires a scopeId");
  }

  if (typeof rawScopeId !== "string" || !isSafeScopeId(rawScopeId)) {
    return error(400, "invalid_scope_id", `${scope} memory requires a valid scopeId`);
  }

  if (scope === "room") {
    if (!AgentManager.getRooms().some((room) => room.id === rawScopeId)) return error(404, "room_not_found", "no such room");
  } else if (scope === "agent") {
    if (!AgentManager.getAllAgents().some((agent) => agent.id === rawScopeId)) return error(404, "agent_not_found", "no such agent");
  } else if (scope === "boss") {
    if (!listUsers(AgentManager.getRooms()).some((user) => user.id === rawScopeId)) return error(404, "user_not_found", "no such user");
  }

  return { scope, scopeId: rawScopeId };
}

function authorFromRequest(req: Request): string {
  const agentName = req.headers.get("x-bureau-agent-name")?.trim();
  if (agentName) return agentName;
  return "Bureau";
}

type AgentMemoryIdentity = NonNullable<ReturnType<typeof resolveAgentToken>>;

function resolveMemoryBearer(req: Request): AgentMemoryIdentity | Response | null {
  const raw = readBearerToken(req);
  if (!raw) return null;
  const identity = resolveAgentToken(raw);
  if (!identity) return error(401, "invalid_token", "invalid bearer token");
  return identity;
}

function authorFromBearer(identity: AgentMemoryIdentity | null, fallback: string): string {
  if (!identity) return fallback;
  return AgentManager.getAllAgents().find((a) => a.id === identity.agentId)?.name ?? fallback;
}

function authorFromCaller(identity: AgentMemoryIdentity | null, auth: AuthResult | undefined, fallback: string): string {
  if (identity) return authorFromBearer(identity, fallback);
  if (auth?.kind === "ok") return getUserById(auth.session.userId)?.name ?? auth.session.username;
  return fallback;
}

function requireMemoryCaller(identity: AgentMemoryIdentity | null, auth: AuthResult | undefined): Response | null {
  if (identity || auth?.kind === "ok") return null;
  return error(401, "unauthenticated", "authenticated caller required");
}

export async function handleMemoryRequest(req: Request, url: URL, auth?: AuthResult): Promise<Response | null> {
  if (url.pathname !== "/api/memory" && url.pathname !== "/memory") return null;
  const bearer = resolveMemoryBearer(req);
  if (bearer instanceof Response) return bearer;
  const unauthenticated = requireMemoryCaller(bearer, auth);
  if (unauthenticated) return unauthenticated;

  if (req.method === "GET") {
    const target = resolveTarget(parseScope(url.searchParams.get("scope") ?? "agent"), url.searchParams.get("scopeId") ?? undefined, bearer, auth);
    if (target instanceof Response) return target;
    return json(memoryStore.read(target.scope, target.scopeId));
  }

  if (req.method === "POST") {
    let body: Record<string, unknown> | null = null;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return error(400, "invalid_json", "invalid JSON body");
    }
    if (typeof body.text !== "string") return error(400, "invalid_text", "text is required");
    if (/[\r\n]/.test(body.text)) return error(400, "invalid_text", "text must be a single line");
    const text = body.text.trim();
    if (!text) return error(400, "invalid_text", "text must not be blank");
    const target = resolveTarget(parseScope(body.scope), body.scopeId, bearer, auth);
    if (target instanceof Response) return target;
    const duplicate = memoryStore.findDuplicate(target.scope, target.scopeId, text);
    if (duplicate) return error(409, "duplicate_memory", "a matching memory already exists in this scope", { matched: { text: duplicate.text } });
    return json(
      memoryStore.append({ scope: target.scope, scopeId: target.scopeId, author: authorFromCaller(bearer, auth, authorFromRequest(req)), authorAgentId: bearer?.agentId ?? null, text }),
      201,
    );
  }

  if (req.method === "PUT") {
    let body: Record<string, unknown> | null = null;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return error(400, "invalid_json", "invalid JSON body");
    }
    if (typeof body.text !== "string") return error(400, "invalid_text", "text is required");
    if (typeof body.version !== "string" || body.version.length === 0) return error(400, "invalid_version", "version is required");
    const target = resolveTarget(parseScope(body.scope), body.scopeId, bearer, auth);
    if (target instanceof Response) return target;
    const result = memoryStore.replace({
      scope: target.scope,
      scopeId: target.scopeId,
      text: body.text,
      author: authorFromCaller(bearer, auth, authorFromRequest(req)),
      expectedVersion: body.version,
    });
    if (!result.ok) return error(409, "memory_conflict", "memory changed since it was read", { version: result.version });
    return json({ version: result.version });
  }

  return error(405, "method_not_allowed", "method not allowed");
}
