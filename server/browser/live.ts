import type { BrowserHumanInput } from "../../shared/wire-client-types.ts";
import type { Page } from "playwright-core";
import { MAX_TEXT_CHARS } from "./params.ts";
import { captureBounds, captureStill, type BrowserFrame, type BrowserFrameListener, type ScreencastFields, type ViewerBounds, startScreencast, stopScreencast } from "./screencast.ts";

export type { BrowserFrame, BrowserFrameListener };

export interface LiveSession extends ScreencastFields {
  opened: boolean;
}

/** Per-agent frame viewers + CDP input. Owned by BrowserPool. */
export class LiveViews {
  private readonly frameListeners = new Map<string, Set<BrowserFrameListener>>();
  private readonly viewerBounds = new Map<BrowserFrameListener, ViewerBounds>();

  watch(agentId: string, listener: BrowserFrameListener, bounds: ViewerBounds, getSession: () => LiveSession | undefined): () => void {
    this.viewerBounds.set(listener, bounds);
    let listeners = this.frameListeners.get(agentId);
    if (!listeners) {
      listeners = new Set();
      this.frameListeners.set(agentId, listeners);
    }
    listeners.add(listener);
    const session = getSession();
    listener(null);
    if (session) {
      const b = this.boundsFor(agentId, session.page);
      if (session.lastFrame && session.captureSize === `${b.maxWidth}x${b.maxHeight}@${b.quality}/${b.deviceScaleFactor}`) listener(session.lastFrame);
      void this.ensureScreencast(agentId, session, getSession);
    }
    return () => {
      const current = this.frameListeners.get(agentId);
      current?.delete(listener);
      this.viewerBounds.delete(listener);
      if (current?.size) {
        const active = getSession();
        if (active) void this.ensureScreencast(agentId, active, getSession);
        return;
      }
      this.frameListeners.delete(agentId);
      void Promise.resolve().then(() => {
        if (this.frameListeners.get(agentId)?.size) return;
        const s = getSession();
        if (s) void stopScreencast(s);
      });
    };
  }

  hasViewers(agentId: string): boolean {
    return !!this.frameListeners.get(agentId)?.size;
  }

  notify(agentId: string, frame: BrowserFrame | null): void {
    for (const listener of this.frameListeners.get(agentId) ?? []) listener(frame);
  }

  ensureScreencast(agentId: string, session: LiveSession, getSession: () => LiveSession | undefined): Promise<void> {
    return startScreencast(session, {
      agentId,
      hasViewers: () => this.hasViewers(agentId),
      viewerBounds: () => [...(this.frameListeners.get(agentId) ?? [])].map((l) => this.viewerBounds.get(l) ?? {}),
      onFrame: (frame) => this.notify(agentId, frame),
      onStatus: () => this.notify(agentId, null),
      stillCurrent: () => getSession() === session,
    });
  }

  async selection(page: Page, backstopMs: number): Promise<{ text: string; truncated: boolean }> {
    return withDeadline(
      page.evaluate((max) => {
        const value = window.getSelection()?.toString() ?? "";
        return { text: value.slice(0, max), truncated: value.length > max };
      }, MAX_TEXT_CHARS),
      backstopMs,
    );
  }

  async humanInput(agentId: string, session: LiveSession, input: Exclude<BrowserHumanInput, { kind: "selection" }>, getSession: () => LiveSession | undefined): Promise<void> {
    const cdp = session.screencast;
    if (!cdp) return;
    if (input.kind === "mouse") {
      await cdp.send("Input.dispatchMouseEvent", {
        type: input.event,
        x: input.x,
        y: input.y,
        ...(input.button === undefined ? {} : { button: input.button }),
        ...(input.clickCount === undefined ? {} : { clickCount: input.clickCount }),
        ...(input.deltaX === undefined ? {} : { deltaX: input.deltaX }),
        ...(input.deltaY === undefined ? {} : { deltaY: input.deltaY }),
        ...(input.modifiers === undefined ? {} : { modifiers: input.modifiers }),
      });
    } else {
      await cdp.send("Input.dispatchKeyEvent", {
        type: input.event,
        key: input.key,
        ...(input.code === undefined ? {} : { code: input.code }),
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.modifiers === undefined ? {} : { modifiers: input.modifiers }),
      });
    }
    await captureStill(session, {
      bounds: this.boundsFor(agentId, session.page),
      stillCurrent: () => getSession() === session,
      onFrame: (frame) => this.notify(agentId, frame),
    });
  }

  private boundsFor(agentId: string, page: Page) {
    const viewers = [...(this.frameListeners.get(agentId) ?? [])].map((l) => this.viewerBounds.get(l) ?? {});
    return captureBounds(page, viewers);
  }

  private readonly idlePages = new Map<string, { url: string; title: string }>();

  closedStatus(agentId: string): { available: false; url: string; title: string; idleClosed?: boolean } {
    const idle = this.idlePages.get(agentId);
    return idle ? { available: false, ...idle, idleClosed: true } : { available: false, url: "", title: "" };
  }

  rememberIdle(agentId: string, url: string, title: string): void {
    if (/^https?:\/\//.test(url)) this.idlePages.set(agentId, { url, title });
    else this.idlePages.delete(agentId);
  }

  forgetIdle(agentId: string): void {
    this.idlePages.delete(agentId);
  }
}

class DeadlineError extends Error {}

export async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError()), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export { DeadlineError, stopScreencast };
