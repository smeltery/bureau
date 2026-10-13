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

export function handleAppChatRequest(req: Request, url: URL, authenticate: () => AuthResult, getStatus = statusFor): Response | null {
  const match = /^\/api\/apps\/([a-z0-9-]+)\/chat-view$/.exec(url.pathname);
  if (!match) return null;
  const auth = authenticate();
  if (auth.kind !== "ok") return Response.json({ error: "unauthorized" }, { status: 401 });
  const status = getStatus(match[1]!, auth.session);
  if (req.method !== "GET" || !status || url.searchParams.getAll("generation").length !== 1 || url.searchParams.get("generation") !== String(status.hostGen))
    return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
