import { useCallback, useLayoutEffect, type RefObject } from "react";

export function composerHeightLimit(isMobile: boolean, verticalInset = 4): number {
  return isMobile ? 8 * 20 + verticalInset : 200;
}

export function useComposerResize(ref: RefObject<HTMLTextAreaElement | null>, value: string, isMobile: boolean, verticalInset = 4, visible = true) {
  const maxHeight = composerHeightLimit(isMobile, verticalInset);
  const resize = useCallback(
    (element: HTMLTextAreaElement) => {
      element.style.height = "auto";
      const border = element.offsetHeight - element.clientHeight;
      element.style.height = Math.min(element.scrollHeight + border, maxHeight) + "px";
    },
    [maxHeight],
  );

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !visible) return;
    resize(element);
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      resize(element);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, value, resize, visible]);

  return resize;
}
