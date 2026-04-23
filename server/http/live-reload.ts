import { watch } from "fs";
import { join } from "path";

export const LIVE_RELOAD_PATH = "/__live_reload";

const liveReloadEnabled = process.env.BUREAU_LIVE_RELOAD === "1";
const liveReloadClients = new Set<ReadableStreamDefaultController<string>>();
let liveReloadDebounce: ReturnType<typeof setTimeout> | null = null;

const UI_DIST = join(import.meta.dir, "..", "..", "ui", "dist");

function broadcastLiveReload() {
  for (const controller of liveReloadClients) {
    try {
      controller.enqueue("data: reload\n\n");
    } catch {
      liveReloadClients.delete(controller);
    }
  }
}

export function startLiveReloadWatcher() {
  if (!liveReloadEnabled) return;
  watch(UI_DIST, { recursive: true }, () => {
    if (liveReloadDebounce) clearTimeout(liveReloadDebounce);
    liveReloadDebounce = setTimeout(() => {
      broadcastLiveReload();
    }, 120);
  });
}

export function handleLiveReloadRequest(req: Request, url: URL): Response | null {
  if (url.pathname !== LIVE_RELOAD_PATH) return null;
  const stream = new ReadableStream<string>({
    start(controller) {
      liveReloadClients.add(controller);
      controller.enqueue(": connected\n\n");
      const onAbort = () => {
        liveReloadClients.delete(controller);
        try { controller.close(); } catch {}
      };
      req.signal.addEventListener("abort", onAbort, { once: true });
    },
    cancel() {
      // Client disconnects are handled by abort listener cleanup.
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
