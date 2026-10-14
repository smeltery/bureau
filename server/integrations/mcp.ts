import { oauthAccessToken } from "./oauth/store.ts";
import type { IntegrationScope, SecretForm } from "../../shared/integrations/connections.ts";
import { integrationStore, type IntegrationStore } from "./store.ts";
import { credentialRuntime } from "./proxy/runtime.ts";

export interface AgentMcpServer {
  name: string;
  url: string;
  headers: Record<string, string>;
}
export function credentialHeader(form: SecretForm, value: string): Record<string, string> {
  return form.kind === "header" ? { [form.header]: value } : { Authorization: /^[A-Za-z][A-Za-z0-9-]* \S/.test(value) ? value : `Bearer ${value}` };
}
export function resolveMcpServers(userId?: string | null, store: IntegrationStore = integrationStore, placeholder = credentialRuntime.placeholder): AgentMcpServer[] {
  const scopes: IntegrationScope[] = [{ kind: "office" }, ...(userId ? [{ kind: "member" as const, userId }] : [])];
  const selected = new Map<string, { scope: IntegrationScope; server: ReturnType<IntegrationStore["list"]>["mcp"][number] }>();
  for (const scope of scopes) {
    try {
      for (const server of store.list(scope).mcp) selected.set(server.name, { scope, server });
    } catch {
      console.warn("[integrations] unreadable MCP registrations were excluded");
    }
  }
  const result: AgentMcpServer[] = [];
  for (const { scope, server } of selected.values()) {
    try {
      let headers = {};
      if (server.oauth) {
        const token = oauthAccessToken(scope, server);
        if (!token) throw new Error("Browser sign-in required.");
        headers = credentialHeader({ kind: "authorization" }, token);
      } else if (server.secret) {
        const secret = store.privateSecrets(scope).find((item) => item.name === server.secret);
        const standIn = placeholder(scope, server.secret);
        const url = new URL(server.url);
        if (!secret || !standIn || url.port || !secret.hosts.includes(url.hostname)) throw new Error("Credential unavailable.");
        headers = credentialHeader(secret.form, standIn);
      }
      result.push({ name: `bureau-${server.name}`, url: server.url, headers });
    } catch {
      console.warn("[integrations] an MCP registration has no usable credential and was excluded");
    }
  }
  return result;
}
export function codexMcpConfig(servers?: AgentMcpServer[]): Record<string, unknown> {
  return Object.fromEntries((servers ?? []).map((server) => [`mcp_servers.${server.name}`, { url: server.url, http_headers: server.headers }]));
}
export function openCodeMcpConfig(servers: AgentMcpServer[]): Record<string, unknown> {
  return Object.fromEntries(servers.map((server) => [server.name, { type: "remote", url: server.url, headers: server.headers, enabled: true, oauth: false }]));
}
