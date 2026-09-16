// CDP Page.startScreencast for the experimental agent-browser live view.
import type { BrowserContext, CDPSession, Page } from "playwright-core";

export interface BrowserFrame {
  data: string;
  width: number;
  height: number;
}

export type BrowserFrameListener = (frame: BrowserFrame | null) => void;

export interface ScreencastFields {
  context: BrowserContext;
  page: Page;
  screencast: CDPSession | null;
  screencastStarting: Promise<void> | null;
  captureSize: string | null;
  lastFrame: BrowserFrame | null;
  title: string;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const JPEG_QUALITY = 60;

export function captureBounds(page: Page, viewers: Iterable<{ maxWidth?: number; maxHeight?: number }>): { maxWidth: number; maxHeight: number; quality: number } {
  const viewport = page.viewportSize() ?? { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  const list = [...viewers];
  if (!list.length) return { maxWidth: viewport.width, maxHeight: viewport.height, quality: JPEG_QUALITY };
  return {
    quality: JPEG_QUALITY,
    maxWidth: Math.min(viewport.width, Math.max(...list.map((b) => b.maxWidth ?? viewport.width))),
    maxHeight: Math.min(viewport.height, Math.max(...list.map((b) => b.maxHeight ?? viewport.height))),
  };
}

export async function stopScreencast(session: ScreencastFields): Promise<void> {
  const cdp = session.screencast;
  if (!cdp) return;
  session.screencast = null;
  session.captureSize = null;
  session.lastFrame = null;
  await cdp.send("Page.stopScreencast").catch(() => {});
  await cdp.detach().catch(() => {});
}

export async function startScreencast(
  session: ScreencastFields,
  opts: {
    agentId: string;
    hasViewers: () => boolean;
    viewerBounds: () => Iterable<{ maxWidth?: number; maxHeight?: number }>;
    onFrame: (frame: BrowserFrame | null) => void;
    onStatus: () => void;
    stillCurrent: () => boolean;
  },
): Promise<void> {
  if (!opts.hasViewers()) return;
  if (session.screencastStarting) {
    await session.screencastStarting;
    return startScreencast(session, opts);
  }
  const bounds = captureBounds(session.page, opts.viewerBounds());
  const size = `${bounds.maxWidth}x${bounds.maxHeight}@${bounds.quality}`;
  if (session.screencast && session.captureSize === size) return;
  const starting = (async () => {
    if (session.screencast) await stopScreencast(session);
    await startScreencastNow(session, opts, bounds, size);
  })();
  session.screencastStarting = starting;
  try {
    await starting;
  } finally {
    if (session.screencastStarting === starting) session.screencastStarting = null;
  }
}

async function startScreencastNow(
  session: ScreencastFields,
  opts: Parameters<typeof startScreencast>[1],
  bounds: { maxWidth: number; maxHeight: number; quality: number },
  size: string,
): Promise<void> {
  try {
    const cdp = await session.context.newCDPSession(session.page);
    if (!opts.stillCurrent() || session.page.isClosed() || !opts.hasViewers()) {
      await cdp.detach().catch(() => {});
      return;
    }
    session.screencast = cdp;
    cdp.on("Page.frameNavigated", () => {
      void updateTitle(session, opts);
    });
    await cdp.send("Page.enable");
    await updateTitle(session, opts);
    let receivedFrame = false;
    cdp.on("Page.screencastFrame", (event: { data: string; sessionId: number; metadata?: { deviceWidth?: number; deviceHeight?: number } }) => {
      void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
      if (session.screencast !== cdp) return;
      receivedFrame = true;
      const viewport = session.page.viewportSize() ?? { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
      const frame = {
        data: event.data,
        width: event.metadata?.deviceWidth ?? viewport.width,
        height: event.metadata?.deviceHeight ?? viewport.height,
      };
      publishFrame(session, frame, opts.onFrame);
    });
    if (session.screencast !== cdp || !opts.hasViewers()) return;
    session.captureSize = size;
    await cdp.send("Page.startScreencast", { format: "jpeg", everyNthFrame: 2, ...bounds });
    // Static tabs may emit nothing with everyNthFrame > 1 — seed once.
    if (!receivedFrame) {
      const viewport = session.page.viewportSize() ?? { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
      const shot = await cdp
        .send("Page.captureScreenshot", {
          format: "jpeg",
          quality: bounds.quality,
          clip: {
            x: 0,
            y: 0,
            ...viewport,
            scale: Math.min(bounds.maxWidth / viewport.width, bounds.maxHeight / viewport.height),
          },
        })
        .catch(() => null);
      if (shot?.data && !receivedFrame && session.screencast === cdp && opts.stillCurrent()) {
        publishFrame(session, { data: shot.data, ...viewport }, opts.onFrame);
      }
    }
  } catch {
    if (session.screencast) await stopScreencast(session);
    opts.onFrame(null);
    opts.onStatus();
  }
}

export function publishFrame(session: ScreencastFields, frame: BrowserFrame, onFrame: (frame: BrowserFrame | null) => void): void {
  const viewport = session.page.viewportSize();
  if (viewport && (frame.width !== viewport.width || frame.height !== viewport.height)) return;
  session.lastFrame = frame;
  onFrame(frame);
}

async function updateTitle(session: ScreencastFields, opts: { onStatus: () => void; stillCurrent: () => boolean }): Promise<void> {
  const title = await session.page.title().catch(() => "");
  if (!opts.stillCurrent()) return;
  session.title = title;
  opts.onStatus();
}
