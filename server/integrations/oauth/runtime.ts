import { refreshAuthorization } from "@modelcontextprotocol/sdk/client/auth.js";
import { integrationStore, type IntegrationStore } from "../store.ts";
import { notifyIntegrationChange, onIntegrationChange } from "../changes.ts";
import { oauthStore, type McpOAuthRecord } from "./store.ts";
import { oauthFetch, saveOAuthTokens, validateDiscovery } from "./provider.ts";

let enabled = false;
const refreshing = new Set<string>();
export async function refreshMcpOAuthRecord(
  record: McpOAuthRecord,
  deps: { registrations: IntegrationStore; storage: typeof oauthStore; send: typeof fetch; changed: typeof notifyIntegrationChange } = {
    registrations: integrationStore,
    storage: oauthStore,
    send: fetch,
    changed: notifyIntegrationChange,
  },
): Promise<void> {
  const key = JSON.stringify([record.scope, record.name]);
  if (refreshing.has(key)) return;
  refreshing.add(key);
  try {
    const server = deps.registrations.list(record.scope).mcp.find((item) => item.name === record.name);
    if (!server?.oauth || server.url !== record.url || server.createdAt !== record.createdAt || server.id !== record.registrationId) {
      deps.storage.remove(record.scope, record.name);
      return;
    }
    if (record.signInNeeded || (record.expiresAt ?? 0) > Date.now() + 5 * 60_000) return;
    if (!record.client || !record.discovery || !record.tokens?.refresh_token) {
      if ((record.expiresAt ?? 0) <= Date.now()) {
        record.signInNeeded = true;
        deps.storage.write(record);
      }
      return;
    }
    validateDiscovery(record.discovery, record.url);
    const tokens = await refreshAuthorization(record.discovery.authorizationServerUrl, {
      metadata: record.discovery.authorizationServerMetadata,
      clientInformation: record.client,
      refreshToken: record.tokens.refresh_token,
      resource: new URL(record.url),
      fetchFn: oauthFetch(AbortSignal.timeout(15_000), deps.send),
    });
    const latest = deps.registrations.list(record.scope).mcp.find((item) => item.name === record.name);
    const saved = deps.storage.read(record.scope, record.name);
    if (!latest?.oauth || latest.url !== record.url || latest.createdAt !== record.createdAt || latest.id !== record.registrationId || saved?.tokens?.refresh_token !== record.tokens.refresh_token)
      return;
    saveOAuthTokens(record, tokens);
    deps.storage.write(record);
    await deps.changed(record.scope);
  } catch {
    // Retain a still-valid access token on transient failures; never expose remote error text.
    console.warn("[integrations] an MCP token could not be refreshed; retry sign-in if access expires");
  } finally {
    refreshing.delete(key);
  }
}
export async function enableMcpOAuth(): Promise<void> {
  if (enabled) return;
  enabled = true;
  onIntegrationChange(async (scope) => {
    for (const record of oauthStore.list()) if (JSON.stringify(record.scope) === JSON.stringify(scope)) await refreshMcpOAuthRecord(record);
  });
  await Promise.all(oauthStore.list().map((record) => refreshMcpOAuthRecord(record)));
  const timer = setInterval(() => {
    void Promise.all(oauthStore.list().map((record) => refreshMcpOAuthRecord(record)));
  }, 60_000);
  timer.unref();
}
