import { useEffect, type RefObject } from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { send } from "../ws.ts";

interface MobileTerminalTouchOptions {
  mobile: boolean;
  agentId: string;
  bodyRef: RefObject<HTMLDivElement | null>;
  termRef: RefObject<Terminal | null>;
  fitRef: RefObject<FitAddon | null>;
  scrollMovedRef: RefObject<(() => boolean) | null>;
}

export function useMobileTerminalTouch({ mobile, agentId, bodyRef, termRef, fitRef, scrollMovedRef }: MobileTerminalTouchOptions) {
  // Mobile touch handling: single-finger pan scrolls the scrollback buffer,
  // two-finger pinch scales font size between 10-22px. xterm's canvas
  // renderer hijacks single-finger drag for selection, so the .xterm-viewport
  // never receives the touch; translate the pan to scrollLines() manually.
  useEffect(() => {
    if (!mobile) return;
    const el = bodyRef.current;
    if (!el) return;
    let initialDistance = 0;
    let initialFontSize = 14;
    let pinching = false;
    let rafScheduled = false;
    let scrollLastY: number | null = null;
    let scrollAcc = 0;
    let scrollMoved = false;
    function distance(e: TouchEvent) {
      const [a, b] = [e.touches[0], e.touches[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
    function lineHeightPx() {
      const term = termRef.current;
      if (!term) return 18;
      const fs = (term.options.fontSize as number) ?? 14;
      const lh = (term.options.lineHeight as number) ?? 1;
      return fs * lh;
    }
    function onStart(e: TouchEvent) {
      if (!termRef.current) return;
      if (e.touches.length === 2) {
        pinching = true;
        initialDistance = distance(e);
        initialFontSize = (termRef.current.options.fontSize as number) ?? 14;
        scrollLastY = null;
      } else if (e.touches.length === 1) {
        scrollLastY = e.touches[0].clientY;
        scrollAcc = 0;
        scrollMoved = false;
      }
    }
    function onMove(e: TouchEvent) {
      const term = termRef.current;
      if (!term) return;
      if (pinching && e.touches.length === 2) {
        e.preventDefault();
        const ratio = distance(e) / initialDistance;
        const next = Math.max(10, Math.min(22, Math.round(initialFontSize * ratio)));
        if (next !== term.options.fontSize) {
          term.options.fontSize = next;
          if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(() => {
              rafScheduled = false;
              fitRef.current?.fit();
            });
          }
        }
      } else if (!pinching && e.touches.length === 1 && scrollLastY !== null) {
        e.preventDefault();
        const currentY = e.touches[0].clientY;
        const dy = currentY - scrollLastY;
        scrollLastY = currentY;
        scrollAcc -= dy / lineHeightPx();
        const lines = Math.trunc(scrollAcc);
        if (lines !== 0) {
          term.scrollLines(lines);
          scrollAcc -= lines;
          scrollMoved = true;
        }
      }
    }
    function onEnd(e: TouchEvent) {
      if (e.touches.length >= 2) return;
      if (pinching) {
        pinching = false;
        fitRef.current?.fit();
        if (termRef.current) {
          send({ type: "terminal_resize", agentId, cols: termRef.current.cols, rows: termRef.current.rows });
        }
      }
      scrollLastY = null;
    }
    function getScrollMoved() {
      return scrollMoved;
    }
    scrollMovedRef.current = getScrollMoved;
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      scrollMovedRef.current = null;
    };
  }, [mobile, agentId, bodyRef, termRef, fitRef, scrollMovedRef]);
}
