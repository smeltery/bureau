import type { AppRecord } from "../../../shared/apps.ts";
import type { AppMetadata } from "./metadata.ts";
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export function appIcon(name: string) {
  return (
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="38" fill="#334155"/><text x="96" y="128" text-anchor="middle" font-family="sans-serif" font-size="110" fill="white">${escape(name.slice(0, 1).toUpperCase())}</text></svg>`,
    )
  );
}
export function appManifest(app: Pick<AppRecord, "name">, metadata: AppMetadata, android: boolean) {
  const path = `/${app.name}/`;
  return {
    id: path,
    start_url: path,
    scope: path,
    name: metadata.title,
    short_name: metadata.title,
    display: "standalone",
    background_color: "#0a0e16",
    theme_color: "#0a0e16",
    icons: [
      ...(metadata.icons.length ? metadata.icons : [appIcon(app.name)]).map((src) => ({
        src,
        sizes: "any",
        type: src.startsWith("data:image/png") ? "image/png" : src.startsWith("data:image/x-icon") ? "image/x-icon" : "image/svg+xml",
      })),
      ...(android ? [192, 512].map((size) => ({ src: `/icons/icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png" })) : []),
    ],
  };
}
export async function installPageMetadata(html: string, app: Pick<AppRecord, "name" | "hostGen">, metadata: AppMetadata) {
  const manifest = `/api/apps/${encodeURIComponent(app.name)}/manifest?generation=${app.hostGen}`;
  const icons = (metadata.icons.length ? metadata.icons : [appIcon(app.name)]).map((icon) => `<link rel="icon" href="${escape(icon)}">`).join("");
  return new HTMLRewriter()
    .on("title", {
      element(element) {
        element.setInnerContent(metadata.title);
      },
    })
    .on("link", {
      element(element) {
        if (
          (element.getAttribute("rel") ?? "")
            .toLowerCase()
            .split(/\s+/)
            .some((rel) => ["icon", "apple-touch-icon", "manifest"].includes(rel))
        )
          element.remove();
      },
    })
    .on('meta[name="apple-mobile-web-app-title"]', {
      element(element) {
        element.setAttribute("content", metadata.title);
      },
    })
    .on("head", {
      element(element) {
        element.append(`${icons}<link rel="manifest" crossorigin="use-credentials" href="${escape(manifest)}">`, { html: true });
      },
    })
    .transform(new Response(html))
    .text();
}
