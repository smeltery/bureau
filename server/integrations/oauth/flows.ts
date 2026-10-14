import { auth, extractWWWAuthenticateParams } from "@modelcontextprotocol/sdk/client/auth.js";
import { randomBytes } from "node:crypto";
import type { IntegrationScope, RemoteMcpServer } from "../../../shared/integrations/connections.ts";
import { integrationStore, type IntegrationStore } from "../store.ts";
import { oauthKey, oauthStore, type McpOAuthRecord } from "./store.ts";
import { createOAuthProvider, httpsEndpoint, McpOAuthFailure, oauthFetch, validateDiscovery } from "./provider.ts";

interface PendingFlow {
  record: McpOAuthRecord;
  userId: string;
  verifier: string;
  expiresAt: number;
}
export function createOAuthFlows(registrations: IntegrationStore = integrationStore, storage = oauthStore, send: typeof fetch = fetch) {
  const pending = new Map<string, PendingFlow>();
  function current(record: McpOAuthRecord): boolean {
    const server = registrations.list(record.scope).mcp.find((item) => item.name === record.name);
    return !!server?.oauth && server.url === record.url && server.createdAt === record.createdAt && server.id === record.registrationId;
  }
  return {
    async start(scope: IntegrationScope, server: RemoteMcpServer, userId: string, redirectUri: string, client: { clientId?: unknown; clientSecret?: unknown }, authorized: () => boolean) {
      if (!server.oauth) throw new McpOAuthFailure("Enable browser sign-in on this MCP connection first.");
      for (const [state, flow] of pending) if (flow.expiresAt <= Date.now()) pending.delete(state);
      if (pending.size >= 200 || [...pending.values()].filter((flow) => flow.userId === userId).length >= 20) throw new McpOAuthFailure("Too many pending sign-ins. Finish one or wait ten minutes.");
      const previous = storage.read(scope, server.name);
      const record: McpOAuthRecord = { scope, name: server.name, url: server.url, createdAt: server.createdAt, registrationId: server.id, redirectUri };
      if (previous?.url === server.url && previous.createdAt === server.createdAt && previous.registrationId === server.id && previous.redirectUri === redirectUri) {
        record.client = previous.client;
        record.discovery = previous.discovery;
      }
      if (client.clientId !== undefined && client.clientId !== "") {
        if (typeof client.clientId !== "string" || !/^[\x21-\x7e]{1,512}$/.test(client.clientId)) throw new McpOAuthFailure("Enter a valid pre-registered client ID.");
        if (client.clientSecret !== undefined && (typeof client.clientSecret !== "string" || client.clientSecret.length > 16384 || /[\x00-\x1f\x7f]/.test(client.clientSecret)))
          throw new McpOAuthFailure("Enter a valid client secret.");
        record.client = { client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret as string } : {}) };
      } else if (client.clientSecret) throw new McpOAuthFailure("A client secret requires a client ID.");
      if (record.discovery) validateDiscovery(record.discovery, record.url);
      const state = randomBytes(32).toString("base64url");
      const provider = createOAuthProvider(record, state);
      const fetchFn = oauthFetch(AbortSignal.timeout(15_000), send);
      const probe = await fetchFn(httpsEndpoint(record.url), { headers: { Accept: "application/json, text/event-stream" } });
      const challenge = extractWWWAuthenticateParams(probe);
      await probe.body?.cancel();
      const result = await auth(provider.provider, { serverUrl: record.url, resourceMetadataUrl: challenge.resourceMetadataUrl, scope: challenge.scope, fetchFn });
      const authorizationUrl = provider.authorizationUrl();
      if (result !== "REDIRECT" || !authorizationUrl || !provider.verifier()) throw new McpOAuthFailure("The service did not offer a browser sign-in flow.");
      if (!authorized() || !current(record)) throw new McpOAuthFailure("Access or connection settings changed during sign-in.");
      for (const [key, flow] of pending) if (oauthKey(flow.record.scope, flow.record.name) === oauthKey(scope, server.name)) pending.delete(key);
      pending.set(state, { record, userId, verifier: provider.verifier(), expiresAt: Date.now() + 10 * 60_000 });
      return authorizationUrl;
    },
    async finish(state: string, userId: string, code: string | null, denied: boolean, authorized: (scope: IntegrationScope) => boolean): Promise<IntegrationScope> {
      const flow = pending.get(state);
      if (!flow || flow.expiresAt <= Date.now()) {
        pending.delete(state);
        throw new McpOAuthFailure("This sign-in expired or was already used. Start again from Connections.");
      }
      if (flow.userId !== userId || !authorized(flow.record.scope)) throw new McpOAuthFailure("Finish sign-in with the same Bureau member who started it.");
      pending.delete(state);
      if (denied || !code || code.length > 8192) throw new McpOAuthFailure("Sign-in was not completed. You can try again from Connections.");
      if (!current(flow.record)) throw new McpOAuthFailure("The MCP connection changed during sign-in. Start again.");
      const provider = createOAuthProvider(flow.record, state, flow.verifier);
      const result = await auth(provider.provider, { serverUrl: flow.record.url, authorizationCode: code, fetchFn: oauthFetch(AbortSignal.timeout(15_000), send) });
      if (result !== "AUTHORIZED" || !flow.record.tokens) throw new McpOAuthFailure("The service did not authorize this connection.");
      if (!authorized(flow.record.scope) || !current(flow.record)) throw new McpOAuthFailure("Access or connection settings changed during sign-in.");
      storage.write(flow.record);
      return flow.record.scope;
    },
    cancel(scope: IntegrationScope, name: string) {
      for (const [key, flow] of pending) if (oauthKey(flow.record.scope, flow.record.name) === oauthKey(scope, name)) pending.delete(key);
      storage.remove(scope, name);
    },
  };
}
export const mcpOAuthFlows = createOAuthFlows();
