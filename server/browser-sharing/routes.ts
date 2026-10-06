import type { AuthResult } from "../auth/auth-middleware.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import * as Agents from "../agent-manager.ts";
import { getUserById } from "../users.ts";
import { boundedBody } from "../http/body/bounded.ts";
import { browserDevice, createPairingCode, listDevices, pairBrowser, revokeBrowser } from "./devices.ts";
import { completeBrowserAction, currentGrants, eligibleAgent, grantTab, pollBrowser, requestBrowserAction, revokeDeviceGrants, revokeGrant } from "./broker.ts";

const jsonBody = async (req: Request, limit = 32_768) => JSON.parse((await boundedBody(req, limit)).toString("utf8"));
const failure = (error: unknown, status = 400) => Response.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });

export async function handleExtensionRequest(req: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/browser-sharing/extension/")) return null;
  const extensionId = req.headers.get("x-bureau-extension");
  const claimedOrigin = extensionId ? `chrome-extension://${extensionId}` : "";
  const origin = req.headers.get("origin") ?? claimedOrigin;
  if (claimedOrigin && claimedOrigin !== origin) return failure(new Error("Extension origin mismatch"), 403);
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return failure(new Error("Extension origin required"), 403);
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Bureau-Extension",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  let response: Response;
  try {
    if (req.method === "OPTIONS") response = new Response(null, { status: 204 });
    else response = await extensionRoute(req, url, origin);
  } catch (error) {
    response = failure(error);
  }
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}
async function extensionRoute(req: Request, url: URL, origin: string): Promise<Response> {
  const path = url.pathname.slice("/browser-sharing/extension/".length);
  if (path === "pair" && req.method === "POST") {
    const body = await jsonBody(req);
    if (typeof body.code !== "string" || typeof body.name !== "string") throw new Error("Pairing code and device name required");
    const paired = pairBrowser(body.code, body.name, origin);
    if (!paired) return failure(new Error("Invalid or expired pairing code"), 401);
    const { token, device } = paired;
    return Response.json({ token, deviceId: device.id }, { status: 201 });
  }
  const device = browserDevice(readBearerToken(req) ?? "", origin);
  if (!device) return failure(new Error("Pair this browser again"), 401);
  if (path === "agents" && req.method === "GET")
    return Response.json(
      Agents.getAllAgents()
        .filter((agent) => eligibleAgent(device.userId, agent.id))
        .map((agent) => ({ id: agent.id, name: agent.name })),
    );
  if (path === "poll" && req.method === "GET") return Response.json(pollBrowser(device.id));
  if (path === "grants" && req.method === "POST") return Response.json(grantTab(device, await jsonBody(req)), { status: 201 });
  const grantId = /^grants\/([a-f0-9]{32})$/.exec(path)?.[1];
  if (grantId && req.method === "DELETE") {
    if (!currentGrants().some((grant) => grant.id === grantId && grant.deviceId === device.id)) return new Response(null, { status: 404 });
    revokeGrant(grantId);
    return new Response(null, { status: 204 });
  }
  const commandId = /^results\/([a-f0-9]{32})$/.exec(path)?.[1];
  if (commandId && req.method === "POST") {
    const body = await jsonBody(req, 2_097_152);
    if (body.error !== undefined && typeof body.error !== "string") throw new Error("Invalid error");
    return new Response(null, { status: completeBrowserAction(device.id, commandId, body.result, body.error) ? 204 : 404 });
  }
  return new Response(null, { status: 404 });
}

export async function handleBrowserSharingRequest(req: Request, url: URL, auth: AuthResult): Promise<Response | null> {
  const agentId = /^\/api\/agents\/([^/]+)\/shared-browser$/.exec(url.pathname)?.[1];
  if (agentId) {
    const token = resolveAgentToken(readBearerToken(req));
    if (!token || token.agentId !== agentId || !token.userId || !eligibleAgent(token.userId, agentId)) return failure(new Error("Matching agent bearer required"), 403);
    const grants = currentGrants().filter((grant) => grant.agentIds.includes(agentId));
    if (req.method === "GET") return Response.json(grants.map(({ id, origin, title, expiresAt }) => ({ id, origin, title, expiresAt })));
    if (req.method !== "POST") return new Response(null, { status: 405 });
    try {
      const body = await jsonBody(req);
      return Response.json({ result: await requestBrowserAction(agentId, body.grantId, body) });
    } catch (error) {
      return failure(error);
    }
  }
  if (!url.pathname.startsWith("/api/browser-sharing/")) return null;
  const user = auth.kind === "ok" ? getUserById(auth.session.userId) : null;
  if (!user) return failure(new Error("Browser session required"), 401);
  const path = url.pathname.slice("/api/browser-sharing/".length);
  try {
    if (path === "pairing" && req.method === "POST") return Response.json({ code: createPairingCode(user.id), expiresIn: 300 });
    if (path === "devices" && req.method === "GET")
      return Response.json(
        listDevices()
          .filter((device) => device.userId === user.id)
          .map(({ id, name, expiresAt }) => ({ id, name, expiresAt })),
      );
    if (path === "grants" && req.method === "GET") return Response.json(currentGrants().filter((grant) => grant.userId === user.id));
    const match = /^(devices|grants)\/([a-f0-9]{32})$/.exec(path);
    if (match && req.method === "DELETE") {
      if (match[1] === "devices" && listDevices().some((device) => device.id === match[2] && device.userId === user.id)) {
        revokeBrowser(match[2]);
        revokeDeviceGrants(match[2]);
        return new Response(null, { status: 204 });
      }
      if (match[1] === "grants" && currentGrants().some((grant) => grant.id === match[2] && grant.userId === user.id)) {
        revokeGrant(match[2]);
        return new Response(null, { status: 204 });
      }
    }
    return new Response(null, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}
