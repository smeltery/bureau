import { oauthAccessToken } from "./oauth/store.ts";
import type { IntegrationScope } from "../../shared/integrations/connections.ts";
import { integrationStore, type IntegrationStore } from "./store.ts";
import { credentialHeader } from "./mcp.ts";
import { scrubBuffer, secretPatterns } from "./proxy/scrub.ts";

export type ConnectionTestResult = { ok: true; label?: string; tools?: number } | { ok: false; error: string };
class ConnectionTestFailure extends Error {}
type FetchConnection = (url: string, init: RequestInit) => Promise<Response>;
async function readReply(response: Response): Promise<Record<string, any>> {
  const reader = response.body?.getReader();
  if (!reader) throw new ConnectionTestFailure("The service returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) throw new ConnectionTestFailure("The service response exceeded the test limit.");
      chunks.push(value);
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        const text = Buffer.concat(chunks).toString();
        for (const event of text.split(/\r?\n\r?\n/).slice(0, -1)) {
          const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          const parsed = JSON.parse(data);
          if (parsed.result || parsed.error) return parsed;
        }
      }
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ConnectionTestFailure("The service returned an invalid response.");
    return parsed;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
function cleanLabel(value: unknown, credential: string | null, url: string): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > 100 || /[\x00-\x1f\x7f]/.test(value)) return undefined;
  const target = new URL(url);
  const sensitive = [credential ?? "", ...target.pathname.split("/"), ...[...target.searchParams].flat()].filter((part) => part.length >= 8);
  if (scrubBuffer(Buffer.from(value), secretPatterns(sensitive)).toString() !== value) return undefined;
  return value;
}
export async function testConnection(
  scope: IntegrationScope,
  kind: "secrets" | "mcp",
  name: string,
  store: IntegrationStore = integrationStore,
  send: FetchConnection = fetch,
): Promise<ConnectionTestResult> {
  const signal = AbortSignal.timeout(10_000);
  let credential: string | null = null;
  try {
    const entries = store.list(scope);
    const secret = kind === "secrets" ? store.privateSecrets(scope).find((item) => item.name === name) : undefined;
    const server = kind === "mcp" ? entries.mcp.find((item) => item.name === name) : undefined;
    if (!secret && !server) return { ok: false, error: "Connection not found." };
    const resolved = secret ?? (server?.secret ? store.privateSecrets(scope).find((item) => item.name === server.secret) : undefined);
    if (server?.secret && (!resolved || !resolved.hosts.includes(new URL(server.url).hostname) || new URL(server.url).port))
      return { ok: false, error: "The configured credential is missing or does not allow this server." };
    const oauthToken = server?.oauth ? oauthAccessToken(scope, server) : null;
    if (server?.oauth && !oauthToken) return { ok: false, error: "Sign in to this MCP connection before testing it." };
    credential = oauthToken ?? resolved?.value ?? null;
    const headers: Record<string, string> = {
      ...(oauthToken ? credentialHeader({ kind: "authorization" }, oauthToken) : resolved ? credentialHeader(resolved.form, resolved.value) : {}),
      "User-Agent": "Bureau",
    };
    async function request(url: string, body?: unknown, extra: Record<string, string> = {}): Promise<Response> {
      const response = await send(url, {
        method: body ? "POST" : "GET",
        headers: { ...headers, ...extra, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ConnectionTestFailure(
          response.status === 401 || response.status === 403
            ? "The service refused this credential. Check its access and expiry."
            : response.status >= 300 && response.status < 400
              ? "The service redirected the request; credentials were not forwarded."
              : "The service did not accept the connection test.",
        );
      }
      return response;
    }
    if (secret) {
      if (secret.form.kind !== "authorization") return { ok: false, error: "No identity test is available for this credential type." };
      const kind = secret.hosts.includes("api.github.com") ? "github" : secret.hosts.includes("api.stripe.com") ? "stripe" : secret.hosts.includes("api.fly.io") ? "fly" : null;
      if (!kind) return { ok: false, error: "Identity tests are available for GitHub, Stripe and Fly credentials." };
      const url = kind === "github" ? "https://api.github.com/user" : kind === "stripe" ? "https://api.stripe.com/v1/account" : "https://api.fly.io/graphql";
      const reply = await readReply(await request(url, kind === "fly" ? { query: "{ viewer { email } }" } : undefined));
      return { ok: true, label: cleanLabel(kind === "github" ? reply.login : kind === "stripe" ? reply.email || reply.id : reply.data?.viewer?.email, credential, url) };
    }
    const mcp = server!;
    const extra: Record<string, string> = { Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" };
    const initialized = await request(
      mcp.url,
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Bureau", version: "1" } } },
      extra,
    );
    const session = initialized.headers.get("mcp-session-id");
    if (session) extra["Mcp-Session-Id"] = session;
    const init = await readReply(initialized);
    if (init.error || !init.result) return { ok: false, error: "The MCP server refused initialization." };
    const notification = await request(mcp.url, { jsonrpc: "2.0", method: "notifications/initialized" }, extra);
    await notification.body?.cancel();
    let tools = 0;
    let cursor: string | undefined;
    if (init.result.capabilities?.tools)
      for (let page = 0; page < 20; page++) {
        const reply = await readReply(await request(mcp.url, { jsonrpc: "2.0", id: page + 2, method: "tools/list", params: cursor ? { cursor } : {} }, extra));
        if (reply.error || !Array.isArray(reply.result?.tools)) return { ok: false, error: "The MCP server did not return its tools." };
        tools += reply.result.tools.length;
        cursor = reply.result.nextCursor;
        if (!cursor) break;
        if (typeof cursor !== "string" || page === 19) return { ok: false, error: "The MCP tool list exceeded the test limit." };
      }
    return { ok: true, label: cleanLabel(init.result.serverInfo?.name, credential, mcp.url), tools };
  } catch (error) {
    // Transport errors can contain request URLs or credentials; expose only locally defined reasons.
    const safe = error instanceof ConnectionTestFailure ? error.message : signal.aborted ? "The connection test timed out." : "The connection test could not reach or understand the service.";
    return { ok: false, error: safe };
  }
}
