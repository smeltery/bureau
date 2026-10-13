import { useEffect, useState } from "react";

/**
 * Track the visible viewport height on mobile so the container shrinks when
 * the virtual keyboard opens. 100dvh/100vh do not shrink in practice — this
 * reads `window.visualViewport` directly and also scrolls chat to bottom
 * when the keyboard appears.
 *
 * Returns null on desktop (caller should fall back to 100vh CSS).
 */
export function useViewportHeight(isMobile: boolean, scrollRef: React.RefObject<HTMLDivElement | null>): number | null {
  const [vpHeight, setVpHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const bannerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--banner-h")) || 0;
      setVpHeight(vv.height - bannerH);
      window.scrollTo(0, 0);
      // When keyboard opens (viewport shrinks), scroll chat to bottom
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    };
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, [isMobile]);
  return vpHeight;
}

export function logViewFrameStyle(isMobile: boolean, height: number | null, embedded: boolean): import("react").CSSProperties {
  if (embedded) return { height: "100%", minHeight: 0, overflow: "hidden" };
  return isMobile ? { position: "fixed", top: 0, left: 0, right: 0, height: height ?? "calc(100dvh - var(--banner-h, 0px))", overflow: "hidden" } : { height: "calc(100vh - var(--banner-h, 0px))" };
}
