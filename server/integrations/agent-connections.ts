import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import { getUserById } from "../users.ts";
import { integrationStore } from "./store.ts";
import type { IntegrationScope } from "../../shared/integrations/connections.ts";

export function handleAgentConnections(req: Request, url: URL): Response | null {
  if (url.pathname !== "/api/integrations/agent-connections") return null;
  const identity = resolveAgentToken(readBearerToken(req));
  if (!identity || (identity.userId && !getUserById(identity.userId))) return Response.json({ error: "Agent authentication required." }, { status: 401 });
  if (req.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
  const scopes: IntegrationScope[] = [{ kind: "office" }, ...(identity.userId ? [{ kind: "member" as const, userId: identity.userId }] : [])];
  const connections = scopes.map((scope) => {
    try {
      const entries = integrationStore.list(scope);
      return { scope: scope.kind, secrets: entries.secrets.map(({ name, hosts, form, note }) => ({ name, hosts, form, note })), mcp: entries.mcp.map(({ name, note }) => ({ name, note })) };
    } catch {
      return { scope: scope.kind, error: "This scope's connections could not be read." };
    }
  });
  return Response.json({ connections }, { headers: { "Cache-Control": "no-store" } });
}
