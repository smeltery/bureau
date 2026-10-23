import { decodeHTML, decodeHTMLAttribute } from "entities";
import type { AppRecord } from "../../../shared/apps.ts";
import { appSupervisor } from "../supervisor.ts";

export interface AppMetadata {
  title: string;
  icons: string[];
}
export async function parseAppMetadata(html: string, fallback: string): Promise<AppMetadata> {
  let title = "";
  const icons: string[] = [];
  await new HTMLRewriter()
    .on("head title", {
      text(chunk) {
        if (title.length < 512) title += chunk.text.slice(0, 512 - title.length);
      },
    })
    .on("head link", {
      element(element) {
        const rel = (element.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
        const href = decodeHTMLAttribute(element.getAttribute("href") ?? "");
        // Embedded images work without sharing office credentials with app hosts.
        if (rel.includes("icon") && /^data:image\/(?:svg\+xml|png|x-icon)(?:;base64)?,/i.test(href) && href.length < 32768 && icons.length < 4) icons.push(href);
      },
    })
    .transform(new Response(html))
    .text();
  return {
    title:
      decodeHTML(title)
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, 160) || fallback,
    icons,
  };
}
export function createMetadataReader(deps: { running: (app: AppRecord) => boolean; fetch: (url: string, init: RequestInit) => Promise<Response>; now: () => number }) {
  const cache = new Map<string, { until: number; metadata: AppMetadata }>();
  let active = 0;
  return async (app: AppRecord): Promise<AppMetadata> => {
    const fallback = { title: app.name, icons: [] };
    if (!Number.isInteger(app.port) || app.port < 21000 || app.port > 21999) return fallback;
    try {
      if (!deps.running(app)) return fallback;
    } catch {
      return fallback;
    }
    const key = `${app.name}:${app.hostGen}:${app.hostLabel}:${app.port}`;
    const cached = cache.get(key);
    if (cached && cached.until > deps.now()) return cached.metadata;
    if (active >= 4) return fallback;
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await deps.fetch(`http://127.0.0.1:${app.port}/`, { redirect: "error", signal: controller.signal, headers: { Accept: "text/html" } });
      if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
        await response.body?.cancel();
        return fallback;
      }
      const reader = response.body?.getReader();
      if (!reader) return fallback;
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.length;
          if (bytes > 262144) return fallback;
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      const metadata = await parseAppMetadata(Buffer.concat(chunks).toString("utf8"), app.name);
      if (cache.size >= 128) cache.delete(cache.keys().next().value!);
      cache.set(key, { until: deps.now() + 60000, metadata });
      return metadata;
    } catch {
      return fallback;
    } finally {
      clearTimeout(timer);
      active--;
    }
  };
}
export const readAppMetadata = createMetadataReader({ running: (app) => appSupervisor.states([app.name]).get(app.name)?.state === "running", fetch, now: Date.now });
