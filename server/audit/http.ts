import { handleRecordingRequest } from "../terminal-recordings/http.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { readSessionCookies, validateSession } from "../auth/auth.ts";
import { resolveApiToken } from "../auth/api-tokens.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import { resolveCronRunBearer } from "../cronjobs/run-messaging.ts";
import { resolveAppToken } from "../apps/tokens.ts";
import { privilegedAgentIdentity } from "../http/agent-route-helpers.ts";
import { withAuditContext } from "./context.ts";
import { readAuditPage } from "./store.ts";

function actor(req: Request): string {
  const raw = readBearerToken(req);
  if (raw) {
    const agent = resolveAgentToken(raw);
    if (agent) return `agent:${agent.agentId}`;
    const token = resolveApiToken(raw);
    if (token) return `member:${token.userId} token:${token.tokenId}`;
    const run = resolveCronRunBearer(raw);
    if (run) return `schedule:${run.cronjobId} run:${run.runId}`;
    const app = resolveAppToken(raw);
    if (app) return `app:${app.appName}`;
    return "unrecognized bearer";
  }
  const session = validateSession(readSessionCookies(req).selected || null);
  return session ? `member:${session.userId} (${session.username})` : "setup/local";
}

export function auditHttpRequest<T>(req: Request, work: () => T): T {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return work();
  const path = new URL(req.url).pathname;
  // Record route structure, never query strings, invite tokens or arbitrary path values.
  const words = new Set(
    "mcp api auth claim accept logout users agents tasks apps rooms schedules cronjobs memory office settings env access invites sessions tokens me browser-sharing extension pair grants webhooks ingress history restore delete member-prompt message messages pager resolve terminal start stop restart thumbnail archive skills audit-log".split(
      " ",
    ),
  );
  const operation = `${req.method} ${path
    .split("/")
    .map((part) => (words.has(part) ? part : part ? ":id" : ""))
    .join("/")}`;
  return withAuditContext({ actor: actor(req), operation }, work);
}

export async function handleAuditRequest(req: Request, url: URL, auth: AuthResult): Promise<Response | null> {
  const recording = await handleRecordingRequest(req, url, auth);
  if (recording) return recording;
  if (url.pathname !== "/api/audit-log") return null;
  const raw = readBearerToken(req);
  const owner =
    raw && auth.kind !== "api" ? privilegedAgentIdentity(req)?.manager.role === "owner" : auth.kind === "ok" ? auth.session.role === "owner" : auth.kind === "api" && auth.token.role === "owner";
  if (!owner) return Response.json({ error: "owner access required" }, { status: 403 });
  if (req.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 });
  try {
    return Response.json(
      readAuditPage({ cursor: url.searchParams.get("cursor") ?? undefined, actor: url.searchParams.get("actor") ?? undefined, operation: url.searchParams.get("operation") ?? undefined }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[audit] read failed", error);
    return Response.json({ error: "Unable to read audit history" }, { status: 500 });
  }
}
