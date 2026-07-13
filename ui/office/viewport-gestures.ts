import { PAN_BLOCKER_SELECTOR, VIEWPORT, type Gesture, type ViewportState } from "./viewport-model.ts";
import type { SceneBounds } from "./viewport-geometry.ts";
import { createTouchGestureHandlers } from "./viewport-touch-gestures.ts";

type MutableRef<T> = { current: T };

export type ViewportGestureRefs = {
  containerRef: MutableRef<HTMLDivElement | null>;
  state: MutableRef<ViewportState>;
  gesture: MutableRef<Gesture>;
  sceneBounds: MutableRef<SceneBounds | null>;
  didPan: MutableRef<boolean>;
  restoreUserSelect: MutableRef<string | null>;
};

export type ViewportGestureActions = {
  clearResetTransition: () => void;
  abortAllGestures: () => void;
  applyTransform: () => void;
  measureSceneBounds: () => void;
  clampPan: () => void;
  zoomAt: (cx: number, cy: number, newScale: number) => void;
};

export function attachViewportGestures(container: HTMLDivElement, refs: ViewportGestureRefs, actions: ViewportGestureActions) {
  const { state, gesture, didPan, restoreUserSelect } = refs;
  const { clearResetTransition, abortAllGestures, applyTransform, measureSceneBounds, clampPan, zoomAt } = actions;

  const resetGesture = () => {
    gesture.current = { kind: "idle" };
  };
  const startPan = (source: "pointer" | "touch", clientX: number, clientY: number, pointerId = -1) => {
    gesture.current = {
      kind: "panning",
      source,
      pointerId,
      committed: false,
      startX: clientX,
      startY: clientY,
      initialSX: state.current.x,
      initialSY: state.current.y,
    };
  };

  function isPanBlocker(target: HTMLElement) {
    return !!target.closest(PAN_BLOCKER_SELECTOR);
  }

  function releasePan(pointerId: number) {
    if (container.hasPointerCapture(pointerId)) {
      container.releasePointerCapture(pointerId);
    }
    container.style.cursor = "";
    if (restoreUserSelect.current !== null) {
      document.body.style.userSelect = restoreUserSelect.current;
      restoreUserSelect.current = null;
    }
  }

  function enterPinch(t1: Touch, t2: Touch) {
    if (gesture.current.kind === "panning" && gesture.current.source === "pointer") {
      // Release the primary pointer's capture so lifting back to a single
      // touch after the pinch doesn't reactivate the old pan anchor.
      // Touch-driven pans don't use pointer capture; nothing to release.
      releasePan(gesture.current.pointerId);
    }
    const rect = container.getBoundingClientRect();
    gesture.current = {
      kind: "pinching",
      startDist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
      initial: { ...state.current },
      initialMidX: (t1.clientX + t2.clientX) / 2 - rect.left,
      initialMidY: (t1.clientY + t2.clientY) / 2 - rect.top,
    };
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    // Normalize deltaY to pixels so Firefox line-mode and page-mode wheels zoom at the same rate as pixel-mode.
    const lineHeight = 16;
    const unit = e.deltaMode === 1 ? lineHeight : e.deltaMode === 2 ? rect.height : 1;
    const delta = -e.deltaY * unit * VIEWPORT.WHEEL_ZOOM_SPEED;
    zoomAt(cx, cy, state.current.scale * (1 + delta));
  }

  function handlePointerDown(e: PointerEvent) {
    if (e.pointerType === "touch") {
      return;
    }
    didPan.current = false;
    if (e.button !== 0) {
      return;
    }
    if (gesture.current.kind === "pinching") {
      return;
    }
    if (isPanBlocker(e.target as HTMLElement)) {
      return;
    }
    e.preventDefault();
    startPan("pointer", e.clientX, e.clientY, e.pointerId);
    container.setPointerCapture(e.pointerId);
    if (restoreUserSelect.current === null) {
      restoreUserSelect.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
    }
  }

  function handlePointerMove(e: PointerEvent) {
    const g = gesture.current;
    if (g.kind !== "panning" || g.source !== "pointer" || g.pointerId !== e.pointerId) {
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    e.preventDefault();
    if (!g.committed) {
      if (Math.abs(dx) < VIEWPORT.PAN_THRESHOLD && Math.abs(dy) < VIEWPORT.PAN_THRESHOLD) {
        return;
      }
      g.committed = true;
      didPan.current = true;
      container.style.cursor = "grabbing";
    }
    state.current.x = g.initialSX + dx;
    state.current.y = g.initialSY + dy;
    clampPan();
    applyTransform();
  }

  function handlePointerUp(e: PointerEvent) {
    const g = gesture.current;
    if (g.kind !== "panning" || g.source !== "pointer" || g.pointerId !== e.pointerId) {
      return;
    }
    releasePan(e.pointerId);
    didPan.current = false;
    resetGesture();
  }

  function handlePointerCancel(e: PointerEvent) {
    const g = gesture.current;
    if (g.kind !== "panning" || g.source !== "pointer" || g.pointerId !== e.pointerId) {
      return;
    }
    handlePointerUp(e);
  }

  function handleNativeDragStart(e: DragEvent) {
    if (gesture.current.kind === "panning" && gesture.current.source === "pointer") {
      e.preventDefault();
    }
  }

  function handleSelectStart(e: Event) {
    if (gesture.current.kind === "panning" && gesture.current.source === "pointer") {
      e.preventDefault();
    }
  }

  const { handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel } = createTouchGestureHandlers({
    applyTransform,
    clampPan,
    container,
    didPan,
    enterPinch,
    gesture,
    resetGesture,
    startPan,
    state,
  });

  const ro = new ResizeObserver(() => {
    measureSceneBounds();
    clampPan();
    applyTransform();
  });
  ro.observe(container);

  container.addEventListener("wheel", handleWheel, { passive: false });
  container.addEventListener("pointerdown", handlePointerDown);
  container.addEventListener("pointermove", handlePointerMove);
  container.addEventListener("pointerup", handlePointerUp);
  container.addEventListener("pointercancel", handlePointerCancel);
  container.addEventListener("dragstart", handleNativeDragStart);
  container.addEventListener("selectstart", handleSelectStart);
  container.addEventListener("touchstart", handleTouchStart, { passive: true });
  container.addEventListener("touchmove", handleTouchMove, { passive: false });
  container.addEventListener("touchend", handleTouchEnd, { passive: true });
  container.addEventListener("touchcancel", handleTouchCancel, { passive: true });

  return () => {
    ro.disconnect();
    clearResetTransition();
    container.removeEventListener("wheel", handleWheel);
    container.removeEventListener("pointerdown", handlePointerDown);
    container.removeEventListener("pointermove", handlePointerMove);
    container.removeEventListener("pointerup", handlePointerUp);
    container.removeEventListener("pointercancel", handlePointerCancel);
    container.removeEventListener("dragstart", handleNativeDragStart);
    container.removeEventListener("selectstart", handleSelectStart);
    container.removeEventListener("touchstart", handleTouchStart);
    container.removeEventListener("touchmove", handleTouchMove);
    container.removeEventListener("touchend", handleTouchEnd);
    container.removeEventListener("touchcancel", handleTouchCancel);
    abortAllGestures();
  };
}
