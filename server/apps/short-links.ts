import type { AppRecord } from "../../shared/apps.ts";
import { RESERVED_APP_NAMES } from "./registry.ts";

export function appShortUrl(app: AppRecord, publicUrl: string | null, officeOrigin: string): string | undefined {
  if (!publicUrl || app.archivedAt !== undefined || RESERVED_APP_NAMES.has(app.name)) return undefined;
  return new URL(`/${app.name}`, officeOrigin).href;
}

export function appShortRedirect(req: Request, lookup: (name: string) => AppRecord | null, publicUrl: (app: AppRecord) => string | null): Response | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const url = new URL(req.url);
  const match = /^\/([a-z0-9][a-z0-9-]*)\/?$/.exec(url.pathname);
  if (!match || RESERVED_APP_NAMES.has(match[1]!)) return null;
  const app = lookup(match[1]!);
  if (!app || app.archivedAt !== undefined) return null;
  const destination = publicUrl(app);
  if (!destination) return null;
  const target = new URL(destination);
  target.search = url.search;
  return new Response(null, { status: 302, headers: { Location: target.href, "Cache-Control": "no-store" } });
}
