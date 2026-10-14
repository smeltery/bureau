import { testConnection } from "./connection-test.ts";
import { handleAgentConnections } from "./agent-connections.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { integrationActor, canManageIntegration, canRevealIntegration } from "./access.ts";
import { integrationStore, IntegrationStoreError } from "./store.ts";
import { IntegrationValidationError, integrationName, secretHosts, type IntegrationScope } from "../../shared/integrations/connections.ts";
import { getUserById, updateUserById } from "../users.ts";
import { managedOfficeEnvPath, managedUserEnvPath, readManagedOfficeEnv, readManagedUserEnv, writeManagedOfficeEnv, writeManagedUserEnv } from "../persistence/managed-env.ts";
import { getOfficeSettings } from "../agents/state.ts";
import { setOfficeSettings } from "../agents/rooms.ts";
import { withAuditContext } from "../audit/context.ts";
import { recordAuditEvent } from "../audit/store.ts";
import { notifyIntegrationChange } from "./changes.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function handleIntegrationsRequest(req: Request, url: URL, auth: AuthResult): Promise<Response | null> {
  const agentConnections = handleAgentConnections(req, url);
  if (agentConnections) return agentConnections;
  const match = /^\/api\/integrations\/(office|members\/([A-Za-z0-9_-]+))(?:\/(secrets|mcp|variables)(?:\/([^/]+)(?:\/(reveal|reissue|test))?)?)?$/.exec(url.pathname);
  if (!match) return null;
  const scope: IntegrationScope = match[1] === "office" ? { kind: "office" } : { kind: "member", userId: match[2]! };
  const actor = integrationActor(req, auth);
  if (!actor) return json({ error: "Authentication required." }, 401);
  if (scope.kind === "member" && !getUserById(scope.userId)) return json({ error: "Member not found." }, 404);
  const canManage = canManageIntegration(actor, scope);
  if (!canManage && !(scope.kind === "office" && req.method === "GET" && !match[4])) return json({ error: "Integration not found." }, 404);
  const kind = match[3];
  let name: string | undefined;
  try {
    name = match[4] ? integrationName(decodeURIComponent(match[4])) : undefined;
    if (req.method === "GET" && !name) {
      const entries = integrationStore.list(scope);
      const values = scope.kind === "office" ? readManagedOfficeEnv() : readManagedUserEnv(scope.userId);
      const variables = Object.entries(values).map(([name, value]) => ({ name, ...(canManage ? { value } : {}) }));
      const visible = canManage ? entries : { secrets: entries.secrets.map(({ name, hosts, note }) => ({ name, hosts, note })), mcp: entries.mcp.map(({ name, note }) => ({ name, note })) };
      return json({ ...visible, variables, canManage, canReveal: canRevealIntegration(actor, scope) });
    }
    if (req.method === "GET" && kind === "secrets" && name && match[5] === "reveal") {
      if (!canRevealIntegration(actor, scope)) return json({ error: "Only the credential's member, or an owner for office credentials, can reveal it." }, 403);
      const secret = integrationStore.privateSecrets(scope).find((item) => item.name === name);
      if (!secret) return json({ error: "Secret not found." }, 404);
      withAuditContext({ actor: actor.label, operation: "integrations.reveal" }, () => recordAuditEvent(`${match[1]}/${name}`, ["secret"], true));
      return json({ value: secret.value });
    }
    if (!canManage || !name || !kind) return json({ error: "Method not allowed." }, 405);
    if (req.method === "POST" && match[5] === "test" && (kind === "secrets" || kind === "mcp")) {
      recordAuditEvent(`${match[1]}/${kind}/${name}`, ["test"]);
      const result = await testConnection(scope, kind, name);
      const current = integrationActor(req, auth);
      if (!current || !canManageIntegration(current, scope)) return json({ error: "Integration access changed." }, 403);
      return json(result);
    }
    if (req.method === "DELETE" && (kind === "secrets" || kind === "mcp")) {
      if (!integrationStore.remove(scope, kind, name)) return json({ error: "Integration not found." }, 404);
      await notifyIntegrationChange(scope);
      return json({ ok: true });
    }
    if (req.method === "POST" && kind === "secrets" && match[5] === "reissue") {
      if (!integrationStore.reissue(scope, name)) return json({ error: "Secret not found." }, 404);
      await notifyIntegrationChange(scope);
      return json({ ok: true });
    }
    if (req.method !== "PUT" && !(req.method === "DELETE" && kind === "variables")) return json({ error: "Method not allowed." }, 405);
    let body: Record<string, unknown> = {};
    if (req.method === "PUT") {
      const text = await req.text();
      if (Buffer.byteLength(text) > 64 * 1024) return json({ error: "Integration request is too large." }, 413);
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: "Invalid JSON object." }, 400);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid JSON object." }, 400);
    }
    const latest = integrationActor(req, auth);
    if (!latest || latest.user.id !== actor.user.id || !canManageIntegration(latest, scope)) return json({ error: "Integration access changed." }, 403);
    if (scope.kind === "member" && !getUserById(scope.userId)) return json({ error: "Member not found." }, 404);
    if (kind === "secrets") {
      if (Object.keys(body).some((key) => !["value", "hosts", "form", "note"].includes(key))) return json({ error: "Unsupported secret field." }, 400);
      const existing = integrationStore.list(scope).secrets.find((item) => item.name === name);
      if (latest.agent && existing && body.hosts !== undefined && secretHosts(body.hosts).some((host) => !existing.hosts.includes(host)))
        return json({ error: "Agents cannot add hosts to an existing secret." }, 403);
      const secret = integrationStore.setSecret(scope, name, body);
      await notifyIntegrationChange(scope);
      return json({ secret });
    }
    if (kind === "mcp") {
      if (Object.keys(body).some((key) => !["url", "secret", "note"].includes(key))) return json({ error: "Unsupported MCP field." }, 400);
      const server = integrationStore.setMcp(scope, name, body);
      await notifyIntegrationChange(scope);
      return json({ server });
    }
    if (kind === "variables") {
      if (req.method === "PUT" && (typeof body.value !== "string" || Object.keys(body).some((key) => key !== "value"))) return json({ error: "A text value is required." }, 400);
      const values = scope.kind === "office" ? readManagedOfficeEnv() : readManagedUserEnv(scope.userId);
      if (req.method === "DELETE") delete values[name];
      else values[name] = body.value as string;
      if (scope.kind === "office") {
        writeManagedOfficeEnv(values);
        const settings = getOfficeSettings();
        setOfficeSettings(settings.prompt, managedOfficeEnvPath());
      } else {
        writeManagedUserEnv(scope.userId, values);
        const linked = updateUserById(scope.userId, { envFile: managedUserEnvPath(scope.userId) });
        if (!linked.ok) return json({ error: "Variable was saved, but the member environment could not be linked." }, 500);
      }
      recordAuditEvent(`${match[1]}/${name}`, ["variable"]);
      await notifyIntegrationChange(scope);
      return json({ ok: true });
    }
    return json({ error: "Not found." }, 404);
  } catch (error) {
    if (error instanceof IntegrationStoreError) return json({ error: error.message }, 500);
    // Validation errors contain fixed descriptions, never supplied credential values.
    if (error instanceof IntegrationValidationError) return json({ error: error.message }, 400);
    console.error("[integrations] an integration request failed");
    return json({ error: "Unable to update the integration." }, 500);
  }
}
