import { assetPath, serveAsset } from "./assets/serve.ts";
import { join } from "path";

const UI_DIST = join(import.meta.dir, "..", "..", "ui", "dist");
const DEMO_DIST = join(import.meta.dir, "..", "..", "demo", "dist");

/**
 * Serve demo assets from DEMO_DIST, UI assets from UI_DIST, or fall back to
 * the UI's index.html for SPA routing. Always returns a Response.
 */
export async function handleStaticRequest(req: Request, url: URL): Promise<Response> {
  const demo = url.pathname === "/demo" || url.pathname.startsWith("/demo/");
  const root = demo ? DEMO_DIST : UI_DIST;
  const pathname = demo ? url.pathname.slice(5) || "/" : url.pathname;
  const path = assetPath(root, pathname === "/" ? "/index.html" : pathname);
  if (!path || /\.(br|gz)$/.test(pathname)) return new Response(null, { status: 404 });
  const response = await serveAsset(req, path);
  if (response) return response;
  if (/\.[^/]+$/.test(pathname)) return new Response(null, { status: 404 });
  return (await serveAsset(req, join(root, "index.html"))) ?? new Response(null, { status: 404 });
}

const INSTALL_ASSETS = new Set(["/manifest.json", "/sw.js", "/icons/icon.svg", "/icons/icon-180.png", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-512-maskable.png"]);
/** Install services may fetch these bundled, non-personal assets without cookies. */
export async function handlePublicInstallAsset(req: Request, url: URL): Promise<Response | null> {
  if (!INSTALL_ASSETS.has(url.pathname) || (req.method !== "GET" && req.method !== "HEAD")) return null;
  const file = Bun.file(join(UI_DIST, url.pathname));
  if (!(await file.exists())) return new Response(null, { status: 404 });
  return new Response(req.method === "HEAD" ? null : file, { headers: { "Content-Type": file.type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" } });
}
