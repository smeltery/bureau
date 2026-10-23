import { readAppMetadata } from "./install/metadata.ts";
import { appManifest } from "./install/manifest.ts";
import type { AppChatStatus } from "../../shared/integrations/app-chat.ts";
import type { SessionLookup } from "../auth/auth.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { appRegistry } from "./registry.ts";
import { appHostDomain, appPublicUrl } from "./domain.ts";
import { appChatStatus } from "./chat-page.ts";

function statusFor(name: string, session: SessionLookup): AppChatStatus | null {
  const app = appRegistry.get(name);
  return appChatStatus(app, session, app ? appPublicUrl(app.hostLabel, appHostDomain()) : null);
}

export async function handleAppChatRequest(
  req: Request,
  url: URL,
  authenticate: () => AuthResult,
  getStatus = statusFor,
  metadata = readAppMetadata,
  getApp = (name: string) => appRegistry.get(name),
): Promise<Response | null> {
  const match = /^\/api\/apps\/([a-z0-9-]+)\/(chat-view|manifest)$/.exec(url.pathname);
  if (!match) return null;
  const auth = authenticate();
  if (auth.kind !== "ok" || req.headers.has("authorization")) return Response.json({ error: "unauthorized" }, { status: 401 });
  const status = getStatus(match[1]!, auth.session);
  if (req.method !== "GET" || !status || url.searchParams.getAll("generation").length !== 1 || url.searchParams.get("generation") !== String(status.hostGen))
    return Response.json({ error: "not_found" }, { status: 404 });
  if (match[2] === "manifest") {
    const app = getApp(match[1]!);
    if (!app || app.hostGen !== status.hostGen) return Response.json({ error: "not_found" }, { status: 404 });
    const values = await metadata(app);
    const currentAuth = authenticate();
    const current = currentAuth.kind === "ok" && currentAuth.session.userId === auth.session.userId ? getStatus(app.name, currentAuth.session) : null;
    const latest = getApp(app.name);
    if (!current || current.hostGen !== app.hostGen || !latest || latest.hostGen !== app.hostGen || latest.hostLabel !== app.hostLabel) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(appManifest(app, values, /Android/i.test(req.headers.get("user-agent") ?? "")), {
      headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store", Vary: "User-Agent" },
    });
  }
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
