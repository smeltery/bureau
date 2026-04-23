import { join } from "path";

const UI_DIST = join(import.meta.dir, "..", "..", "ui", "dist");
const DEMO_DIST = join(import.meta.dir, "..", "..", "demo", "dist");

/**
 * Serve demo assets from DEMO_DIST, UI assets from UI_DIST, or fall back to
 * the UI's index.html for SPA routing. Always returns a Response.
 */
export async function handleStaticRequest(_req: Request, url: URL): Promise<Response> {
  // Demo static file serving
  if (url.pathname === "/demo" || url.pathname === "/demo/" || url.pathname.startsWith("/demo/")) {
    const demoPath =
      url.pathname === "/demo" || url.pathname === "/demo/"
        ? "/index.html"
        : url.pathname.slice("/demo".length);
    const demoFile = Bun.file(join(DEMO_DIST, demoPath));
    if (await demoFile.exists()) {
      return new Response(demoFile, {
        headers: { "Cache-Control": "no-cache" },
      });
    }
    return new Response(Bun.file(join(DEMO_DIST, "index.html")), {
      headers: { "Cache-Control": "no-cache" },
    });
  }

  // Main UI static file serving
  const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = Bun.file(join(UI_DIST, filePath));
  if (await file.exists()) {
    return new Response(file, {
      headers: { "Cache-Control": "no-cache" },
    });
  }
  // SPA fallback
  return new Response(Bun.file(join(UI_DIST, "index.html")), {
    headers: { "Cache-Control": "no-cache" },
  });
}
