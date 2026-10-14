import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpOAuthRecord } from "./store.ts";

export class McpOAuthFailure extends Error {}
export function httpsEndpoint(value: string | URL): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new McpOAuthFailure("MCP sign-in requires HTTPS endpoints without embedded credentials.");
  return url;
}
const sameUrl = (left: string, right: string) => new URL(left).href.replace(/\/+$/, "") === new URL(right).href.replace(/\/+$/, "");
export function validateDiscovery(state: OAuthDiscoveryState, resourceUrl: string): void {
  const issuer = httpsEndpoint(state.authorizationServerUrl);
  const metadata = state.authorizationServerMetadata;
  if (!metadata || !sameUrl(metadata.issuer, issuer.href)) throw new McpOAuthFailure("The authorization server's identity did not match its metadata.");
  if (state.resourceMetadata && !sameUrl(state.resourceMetadata.resource, resourceUrl)) throw new McpOAuthFailure("The sign-in metadata describes another MCP resource.");
  httpsEndpoint(metadata.authorization_endpoint!);
  httpsEndpoint(metadata.token_endpoint);
  if (metadata.registration_endpoint) httpsEndpoint(metadata.registration_endpoint);
}
export function saveOAuthTokens(record: McpOAuthRecord, tokens: OAuthTokens): void {
  if (!tokens.access_token || tokens.access_token.length > 16384 || /[\x00-\x1f\x7f]/.test(tokens.access_token) || tokens.token_type.toLowerCase() !== "bearer")
    throw new McpOAuthFailure("The authorization server returned an unsupported token.");
  record.tokens = { ...tokens, ...(tokens.refresh_token ? {} : record.tokens?.refresh_token ? { refresh_token: record.tokens.refresh_token } : {}) };
  record.expiresAt = Date.now() + Math.max(1, Math.min(tokens.expires_in ?? 3600, 365 * 86400)) * 1000;
  record.signInNeeded = false;
}
export function createOAuthProvider(record: McpOAuthRecord, state: string, verifier = "") {
  let authorizationUrl: string | null = null;
  let codeVerifier = verifier;
  const provider: OAuthClientProvider = {
    redirectUrl: record.redirectUri,
    clientMetadata: {
      client_name: "Bureau",
      redirect_uris: [record.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: record.client?.client_secret ? "client_secret_basic" : "none",
    },
    state: () => state,
    clientInformation: () => record.client,
    saveClientInformation: (client) => {
      record.client = client;
    },
    tokens: () => undefined,
    saveTokens: (tokens) => saveOAuthTokens(record, tokens),
    redirectToAuthorization: (url) => {
      httpsEndpoint(url);
      if (url.searchParams.get("state") !== state) throw new McpOAuthFailure("The authorization response omitted its state binding.");
      authorizationUrl = url.href;
    },
    saveCodeVerifier: (value) => {
      codeVerifier = value;
    },
    codeVerifier: () => codeVerifier,
    discoveryState: () => record.discovery,
    saveDiscoveryState: (discovery) => {
      validateDiscovery(discovery, record.url);
      record.discovery = discovery;
    },
    validateResourceURL: async (_url, resource) => {
      if (resource && !sameUrl(resource, record.url)) throw new McpOAuthFailure("The sign-in resource did not match this connection.");
      return httpsEndpoint(record.url);
    },
    invalidateCredentials: (scope) => {
      if (scope === "all" || scope === "client") delete record.client;
      if (scope === "all" || scope === "tokens") {
        delete record.tokens;
        delete record.expiresAt;
      }
      if (scope === "all" || scope === "discovery") delete record.discovery;
    },
  };
  return { provider, authorizationUrl: () => authorizationUrl, verifier: () => codeVerifier };
}
export function oauthFetch(signal: AbortSignal, send: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    httpsEndpoint(input instanceof Request ? input.url : String(input));
    const response = await send(input, { ...init, redirect: "manual", signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new McpOAuthFailure("MCP sign-in refused a redirected credential request.");
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1024 * 1024) throw new McpOAuthFailure("The sign-in response exceeded its size limit.");
          chunks.push(value);
        }
    } finally {
      await reader?.cancel().catch(() => {});
    }
    return new Response([204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks), { status: response.status, headers: response.headers });
  }) as typeof fetch;
}
