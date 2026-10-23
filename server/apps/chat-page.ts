import { readAppMetadata } from "./install/metadata.ts";
import { installPageMetadata } from "./install/manifest.ts";
import { appRegistry } from "./registry.ts";
import { join } from "node:path";
import type { SessionLookup } from "../auth/auth.ts";
import { getAgent, getRooms } from "../agent-manager.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import type { AppRecord } from "../../shared/apps.ts";
import type { AppChatStatus } from "../../shared/integrations/app-chat.ts";
import { viewerForApp, mayReachApp } from "./host/auth.ts";
import { appSessionExpiresAt } from "./host/auth-store.ts";
import { RESERVED_APP_NAMES } from "./registry.ts";

export function shortAppName(path: string): string | null {
  const match = /^\/([a-z0-9][a-z0-9-]*)\/?$/.exec(path);
  return match && !RESERVED_APP_NAMES.has(match[1]!) ? match[1]! : null;
}

export function appChatStatus(app: AppRecord | null, session: SessionLookup, publicUrl: string | null): AppChatStatus | null {
  const currentUser = getUserById(session.userId);
  if (!currentUser) return null;
  session = { ...session, role: currentUser.role };
  if (!app || !publicUrl || app.archivedAt !== undefined || !mayReachApp(app, viewerForApp(app, session))) return null;
  const agent = app.createdByAgentId ? getAgent(app.createdByAgentId) : undefined;
  const user = getUserById(session.userId);
  const roomId = agent ? (getRooms()[agent.room]?.id ?? agent.roomId) : undefined;
  return {
    name: app.name,
    hostGen: app.hostGen,
    appUrl: publicUrl,
    agentId: agent && user && roomId && canSeeRoom(user, roomId) ? agent.id : null,
    sessionExpiresAt: appSessionExpiresAt(app, session.sessionIdHash),
  };
}

export async function appChatPage(req: Request, app: AppRecord, session: SessionLookup, publicUrl: string | null): Promise<Response> {
  if (!appChatStatus(app, session, publicUrl)) return new Response("not found", { status: 404 });
  const url = new URL(req.url);
  if (!url.pathname.endsWith("/")) return new Response(null, { status: 302, headers: { Location: `/${app.name}/${url.search}`, "Cache-Control": "no-store" } });
  const metadata = await readAppMetadata(app);
  const latest = appRegistry.get(app.name);
  if (!latest || latest.hostGen !== app.hostGen || latest.hostLabel !== app.hostLabel || !appChatStatus(latest, session, publicUrl)) return new Response("not found", { status: 404 });
  const boot = JSON.stringify({ name: app.name, hostGen: app.hostGen, title: metadata.title }).replaceAll("<", "\\u003c");
  const shell = await Bun.file(join(import.meta.dir, "../../ui/dist/index.html")).text();
  const html = (await installPageMetadata(shell, app, metadata))
    .replace("<head>", '<head><base href="/">')
    .replace('<div id="root"></div>', `<div id="root"></div><script>window.__BUREAU_APP__=${boot};</script>`);
  const finalApp = appRegistry.get(app.name);
  if (!finalApp || finalApp.hostGen !== app.hostGen || !appChatStatus(finalApp, session, publicUrl)) return new Response("not found", { status: 404 });
  return new Response(req.method === "HEAD" ? null : html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
