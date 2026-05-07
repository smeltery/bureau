import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry } from "../../../shared/types.ts";

/**
 * Pin a user message to the top of the chat when none are visible in the
 * viewport, so the user always has context for what they asked. The pinned
 * one is the most-recent user_message that's scrolled above the viewport.
 *
 * We measure positions from the DOM rather than relying on IntersectionObserver
 * because IO only fires on isIntersecting flips — when the auto-scroll jumps
 * from top to bottom on initial mount, middle messages go below→above without
 * ever being visible, and IO never fires for them.
 */
export function usePinnedUserMessage(scrollRef: React.RefObject<HTMLDivElement | null>, logs: LogEntry[], agentState: string) {
  const userMsgNodesRef = useRef<Map<string, HTMLElement>>(new Map());
  // Stable per-id ref callbacks: returning the same function for the same id
  // across renders keeps React from triggering cleanup+setup on every render.
  const userMsgRefCbsRef = useRef<Map<string, (node: HTMLDivElement | null) => void>>(new Map());
  const getUserMsgRefCb = useCallback((id: string) => {
    let cb = userMsgRefCbsRef.current.get(id);
    if (!cb) {
      cb = (node: HTMLDivElement | null) => {
        if (node) userMsgNodesRef.current.set(id, node);
        else {
          userMsgNodesRef.current.delete(id);
          userMsgRefCbsRef.current.delete(id);
        }
      };
      userMsgRefCbsRef.current.set(id, cb);
    }
    return cb;
  }, []);

  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(null);
  const recomputePinned = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    for (let i = logs.length - 1; i >= 0; i--) {
      const e = logs[i];
      if (e.kind !== "user_message") continue;
      const node = userMsgNodesRef.current.get(e.id);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      if (r.bottom > rootRect.top && r.top < rootRect.bottom) {
        setPinnedMessageId(null);
        return;
      }
      if (r.bottom <= rootRect.top) {
        setPinnedMessageId(e.id);
        return;
      }
    }
    setPinnedMessageId(null);
  }, [logs, scrollRef]);

  // Recompute after every render that could affect positions, on the next
  // frame so layout has settled (including auto-scroll's double-rAF).
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(recomputePinned));
    return () => cancelAnimationFrame(id);
  }, [recomputePinned, agentState]);

  const pinnedMessage = useMemo(() => (pinnedMessageId ? (logs.find((e) => e.id === pinnedMessageId) ?? null) : null), [logs, pinnedMessageId]);

  const scrollToPinnedMessage = useCallback(() => {
    if (!pinnedMessage) return;
    const target = userMsgNodesRef.current.get(pinnedMessage.id);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pinnedMessage]);

  return { pinnedMessage, scrollToPinnedMessage, getUserMsgRefCb, recomputePinned };
}
