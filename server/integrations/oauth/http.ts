import type { AuthResult } from "../../auth/auth-middleware.ts";
import { buildPublicOrigin } from "../../auth/http-env.ts";
import { integrationActor, canManageIntegration } from "../access.ts";
import { integrationStore } from "../store.ts";
import { mcpOAuthFlows } from "./flows.ts";
import { oauthAccessToken, oauthStore } from "./store.ts";
import { McpOAuthFailure } from "./provider.ts";
import { notifyIntegrationChange } from "../changes.ts";
import { recordAuditEvent } from "../../audit/store.ts";
import { integrationName, type IntegrationScope } from "../../../shared/integrations/connections.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function handleMcpOAuth(req: Request, url: URL, auth: AuthResult): Promise<Response | null> {
  const callback = url.pathname === "/api/integrations/oauth/callback";
  const match = /^\/api\/integrations\/(office|members\/([A-Za-z0-9_-]+))\/mcp\/([^/]+)\/(sign-in|sign-out|sign-in-status)$/.exec(url.pathname);
  if (!callback && !match) return null;
  const actor = integrationActor(req, auth);
  if (!actor || actor.agent || auth.kind !== "ok") return json({ error: "Sign in to Bureau in this browser to manage MCP sign-in." }, 401);
  const allowed = (scope: IntegrationScope) => {
    const current = integrationActor(req, auth);
    return !!current && current.user.id === actor.user.id && !current.agent && canManageIntegration(current, scope);
  };
  try {
    if (callback) {
      if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);
      const scope = await mcpOAuthFlows.finish(url.searchParams.get("state") ?? "", actor.user.id, url.searchParams.get("code"), url.searchParams.has("error"), allowed);
      recordAuditEvent("integrations/mcp/sign-in", ["authorization"]);
      await notifyIntegrationChange(scope);
      return new Response(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MCP connected · Bureau</title><body><h1>MCP connected</h1><p>Your agents will load this connection on their next turn.</p><a href="/settings">Return to Connections in Settings</a></body></html>',
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
          },
        },
      );
    }
    const scope: IntegrationScope = match![1] === "office" ? { kind: "office" } : { kind: "member", userId: match![2]! };
    if (!allowed(scope)) return json({ error: "Connection not found." }, 404);
    const name = integrationName(decodeURIComponent(match![3]!));
    const server = integrationStore.list(scope).mcp.find((item) => item.name === name);
    if (!server?.oauth) return json({ error: "Browser sign-in is not enabled for this connection." }, 404);
    if (req.method === "GET" && match![4] === "sign-in-status") {
      const record = oauthStore.read(scope, name);
      return json({ connected: !!oauthAccessToken(scope, server), expiresAt: record?.expiresAt ?? null });
    }
    if (req.method === "DELETE" && match![4] === "sign-out") {
      mcpOAuthFlows.cancel(scope, name);
      recordAuditEvent(`integrations/mcp/${name}`, ["sign-out"]);
      await notifyIntegrationChange(scope);
      return json({ ok: true });
    }
    if (req.method !== "POST" || match![4] !== "sign-in") return json({ error: "Method not allowed." }, 405);
    const text = await req.text();
    if (Buffer.byteLength(text) > 32 * 1024) return json({ error: "Sign-in request is too large." }, 413);
    let body: Record<string, unknown>;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      return json({ error: "Invalid sign-in request." }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "clientId" && key !== "clientSecret"))
      return json({ error: "Invalid sign-in request." }, 400);
    if (!allowed(scope)) return json({ error: "Integration access changed." }, 403);
    const authorizationUrl = await mcpOAuthFlows.start(scope, server, actor.user.id, `${buildPublicOrigin().origin}/api/integrations/oauth/callback`, body, () => allowed(scope));
    return json({ authorizationUrl });
  } catch (error) {
    const message = error instanceof McpOAuthFailure ? error.message : "MCP sign-in could not complete. Check the server settings or enter a pre-registered client ID.";
    return json({ error: message }, 400);
  }
}
