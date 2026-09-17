// CDP Page.startScreencast for the experimental agent-browser live view.
import type { BrowserContext, CDPSession, Page } from "playwright-core";
import { BROWSER_MAX_DIM, normalizeBrowserDpr } from "./params.ts";

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
  dprOverride: boolean;
  stillInFlight: boolean;
}

export type ViewerBounds = { maxWidth?: number; maxHeight?: number; deviceScaleFactor?: number };

export type CaptureBounds = { maxWidth: number; maxHeight: number; quality: number; deviceScaleFactor: number };

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const JPEG_QUALITY = 60;

export function captureBounds(page: Page, viewers: Iterable<ViewerBounds>): CaptureBounds {
  const viewport = page.viewportSize() ?? { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  const list = [...viewers];
  const deviceScaleFactor = Math.max(1, ...list.map((b) => normalizeBrowserDpr(b.deviceScaleFactor)));
  if (!list.length) {
    return { maxWidth: viewport.width, maxHeight: viewport.height, quality: JPEG_QUALITY, deviceScaleFactor: 1 };
  }
  const cssCapW = viewport.width * deviceScaleFactor;
  const cssCapH = viewport.height * deviceScaleFactor;
  return {
    quality: JPEG_QUALITY,
    deviceScaleFactor,
    maxWidth: Math.min(BROWSER_MAX_DIM, cssCapW, Math.max(...list.map((b) => b.maxWidth ?? cssCapW))),
    maxHeight: Math.min(BROWSER_MAX_DIM, cssCapH, Math.max(...list.map((b) => b.maxHeight ?? cssCapH))),
  };
}

function sizeKey(bounds: CaptureBounds): string {
  return `${bounds.maxWidth}x${bounds.maxHeight}@${bounds.quality}/${bounds.deviceScaleFactor}`;
}

export async function stopScreencast(session: ScreencastFields): Promise<void> {
  const cdp = session.screencast;
  if (!cdp) return;
  session.screencast = null;
  session.captureSize = null;
  session.lastFrame = null;
  session.stillInFlight = false;
  await cdp.send("Page.stopScreencast").catch(() => {});
  const viewport = session.page.viewportSize();
  const restore = session.dprOverride;
  session.dprOverride = false;
  if (viewport && restore) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false }).catch(() => {});
  }
  await cdp.detach().catch(() => {});
}

export async function captureStill(
  session: ScreencastFields,
  opts: {
    bounds: CaptureBounds;
    stillCurrent: () => boolean;
    onFrame: (frame: BrowserFrame | null) => void;
  },
): Promise<void> {
  const cdp = session.screencast;
  if (!cdp || session.page.isClosed() || !opts.stillCurrent()) return;
  const viewport = session.page.viewportSize() ?? { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  const scale = Math.min(opts.bounds.maxWidth / viewport.width, opts.bounds.maxHeight / viewport.height) / opts.bounds.deviceScaleFactor;
  const shot = await cdp
    .send("Page.captureScreenshot", {
      format: "jpeg",
      quality: opts.bounds.quality,
      clip: { x: 0, y: 0, ...viewport, scale },
    })
    .catch(() => null);
  if (shot?.data && session.screencast === cdp && opts.stillCurrent()) {
    // Frame metadata stays CSS so manager hit-testing stays in CSS pixels.
    publishFrame(session, { data: shot.data, ...viewport }, opts.onFrame);
  }
}

export async function startScreencast(
  session: ScreencastFields,
  opts: {
    agentId: string;
    hasViewers: () => boolean;
    viewerBounds: () => Iterable<ViewerBounds>;
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
  const size = sizeKey(bounds);
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

async function startScreencastNow(session: ScreencastFields, opts: Parameters<typeof startScreencast>[1], bounds: CaptureBounds, size: string): Promise<void> {
  try {
    const cdp = await session.context.newCDPSession(session.page);
    if (!opts.stillCurrent() || session.page.isClosed() || !opts.hasViewers()) {
      await cdp.detach().catch(() => {});
      return;
    }
    session.screencast = cdp;
    const viewport = session.page.viewportSize() ?? { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
    session.dprOverride = bounds.deviceScaleFactor > 1;
    if (session.dprOverride) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        ...viewport,
        deviceScaleFactor: bounds.deviceScaleFactor,
        mobile: false,
      });
    }
    cdp.on("Page.frameNavigated", () => {
      void updateTitle(session, opts);
    });
    await cdp.send("Page.enable");
    await updateTitle(session, opts);
    let receivedFrame = false;
    let triggerData: string | undefined;
    cdp.on("Page.screencastFrame", (event: { data: string; sessionId: number; metadata?: { deviceWidth?: number; deviceHeight?: number } }) => {
      void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
      if (session.screencast !== cdp) return;
      if (bounds.deviceScaleFactor > 1) {
        // High-DPR: screencast is a change trigger; publish coalesced JPEG stills.
        if (event.data === triggerData) return;
        triggerData = event.data;
        void queueStill(session, bounds, opts);
        return;
      }
      receivedFrame = true;
      const vp = session.page.viewportSize() ?? { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
      const frame = {
        data: event.data,
        width: event.metadata?.deviceWidth ?? vp.width,
        height: event.metadata?.deviceHeight ?? vp.height,
      };
      publishFrame(session, frame, opts.onFrame);
    });
    if (session.screencast !== cdp || !opts.hasViewers()) return;
    session.captureSize = size;
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      everyNthFrame: bounds.deviceScaleFactor > 1 ? 1 : 2,
      quality: bounds.quality,
      maxWidth: bounds.deviceScaleFactor > 1 ? viewport.width : bounds.maxWidth,
      maxHeight: bounds.deviceScaleFactor > 1 ? viewport.height : bounds.maxHeight,
    });
    if (bounds.deviceScaleFactor > 1) {
      void queueStill(session, bounds, opts);
    } else if (!receivedFrame) {
      await captureStill(session, { bounds, stillCurrent: () => !receivedFrame && opts.stillCurrent(), onFrame: opts.onFrame });
    }
  } catch {
    if (session.screencast) await stopScreencast(session);
    opts.onFrame(null);
    opts.onStatus();
  }
}

async function queueStill(session: ScreencastFields, bounds: CaptureBounds, opts: { stillCurrent: () => boolean; onFrame: (frame: BrowserFrame | null) => void }): Promise<void> {
  if (session.stillInFlight) return;
  session.stillInFlight = true;
  try {
    await captureStill(session, { bounds, stillCurrent: opts.stillCurrent, onFrame: opts.onFrame });
  } finally {
    session.stillInFlight = false;
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
