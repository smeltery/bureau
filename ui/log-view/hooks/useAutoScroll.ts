import { useEffect, useRef, useState } from "react";

/**
 * Stick-to-bottom scroll behavior for the messages pane.
 *
 * - `autoScroll` is true when the user is near the bottom of the scrollable
 *   area, in which case new entries auto-scroll into view.
 * - Calling `handleScroll` (bound to the element's `onScroll`) updates the
 *   flag based on the current position.
 * - When logs are cleared (length drops to 0 from > 0), auto-scroll is
 *   re-enabled so the next message is visible.
 * - The element is scrolled to the bottom whenever logs or agent state
 *   change, using double-rAF to wait for layout.
 */
export function useAutoScroll<T>(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  logs: T[],
  agentState: string,
) {
  const [autoScroll, setAutoScroll] = useState(true);

  // Re-enable auto-scroll when logs are cleared (e.g. /resume, /clear)
  const prevLogsLen = useRef(logs.length);
  useEffect(() => {
    if (logs.length === 0 && prevLogsLen.current > 0) {
      setAutoScroll(true);
    }
    prevLogsLen.current = logs.length;
  }, [logs.length]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      const el = scrollRef.current;
      // Defer scroll until after browser layout so scrollHeight is final.
      // Double-rAF ensures content (images, code blocks, etc.) has been measured.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      });
    }
  }, [logs, autoScroll, agentState]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }

  return { autoScroll, setAutoScroll, handleScroll };
}
