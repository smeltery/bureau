import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppState } from "../store.tsx";
import type { MembersChatMessage } from "../../shared/members-chat.ts";

export function useTeamChatRead(messages: MembersChatMessage[], loading: boolean) {
  const { sessionContext, membersChat } = useAppState();
  const viewportRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const viewportHeight = useRef(0);
  const inFlight = useRef<string | null>(null);
  const acknowledged = useRef<string | null>(null);
  const failedKey = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const userId = sessionContext?.userId;
  const latestId = loading ? undefined : messages.at(-1)?.id;
  const readPointer = membersChat?.userId === userId ? membersChat?.readPointer : null;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (latestId && latestId === readPointer) {
      failedKey.current = null;
      setFailed(false);
    }
  }, [latestId, readPointer]);

  const markRead = useCallback(
    async (retry = false) => {
      const viewport = viewportRef.current;
      if (!userId || !latestId || document.hidden || !viewport || !following.current || viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 48) return;
      const key = userId + ":" + latestId;
      if (latestId === readPointer || acknowledged.current === key || inFlight.current === key) return;
      if (!retry && failedKey.current === key) return;
      inFlight.current = key;
      failedKey.current = null;
      setFailed(false);
      try {
        const response = await fetch("/api/members-chat/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lastReadId: latestId }) });
        if (!response.ok) throw new Error("Could not update read position");
        if (inFlight.current === key) acknowledged.current = key;
        // WebSocket summaries are ordered with new messages. A delayed HTTP
        // response must not replace a newer unread count from that stream.
      } catch {
        if (mounted.current && inFlight.current === key) {
          failedKey.current = key;
          setFailed(true);
        }
      } finally {
        if (inFlight.current === key) inFlight.current = null;
      }
    },
    [latestId, readPointer, userId],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewportHeight.current = viewport.clientHeight;
      if (!loading && following.current) viewport.scrollTop = viewport.scrollHeight;
    }
    void markRead();
  }, [messages, loading, markRead]);

  useEffect(() => {
    const visible = () => {
      if (!document.hidden) void markRead(true);
    };
    const resized = new ResizeObserver(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewportHeight.current = viewport.clientHeight;
      if (following.current) viewport.scrollTop = viewport.scrollHeight;
      void markRead();
    });
    if (viewportRef.current) resized.observe(viewportRef.current);
    document.addEventListener("visibilitychange", visible);
    return () => {
      resized.disconnect();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [markRead]);

  function onScroll() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // A banner or mobile keyboard resizing the pane is not a request to
    // stop following the conversation. Preserve the prior mode on resize.
    if (viewportHeight.current !== viewport.clientHeight) {
      viewportHeight.current = viewport.clientHeight;
      if (following.current) viewport.scrollTop = viewport.scrollHeight;
    } else following.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 48;
    if (following.current) void markRead();
  }
  return { viewportRef, onScroll, failed, retry: () => markRead(true) };
}
