import type { AuthResult } from "../auth/auth-middleware.ts";
import { resolveApiToken } from "../auth/api-tokens.ts";
import { readBearerToken } from "../agents/tokens.ts";
import { privilegedAgentIdentity } from "../http/agent-route-helpers.ts";
import { getUserById } from "../users.ts";
import type { IntegrationScope } from "../../shared/integrations/connections.ts";

export function integrationActor(req: Request, auth: AuthResult) {
  const bearer = readBearerToken(req);
  if (bearer) {
    const token = auth.kind === "api" ? resolveApiToken(bearer) : null;
    const operator = token ? null : privilegedAgentIdentity(req);
    const user = token ? getUserById(token.userId) : operator?.manager;
    return user ? { user, agent: !!operator, label: operator ? `agent:${operator.agentId}` : `member:${user.id} token:${token!.tokenId}` } : null;
  }
  const user = auth.kind === "ok" ? getUserById(auth.session.userId) : null;
  return user ? { user, agent: false, label: `member:${user.id}` } : null;
}
export function canManageIntegration(actor: NonNullable<ReturnType<typeof integrationActor>>, scope: IntegrationScope): boolean {
  return actor.user.role === "owner" || (scope.kind === "member" && scope.userId === actor.user.id);
}
export function canRevealIntegration(actor: NonNullable<ReturnType<typeof integrationActor>>, scope: IntegrationScope): boolean {
  return !actor.agent && (scope.kind === "office" ? actor.user.role === "owner" : scope.userId === actor.user.id);
}
