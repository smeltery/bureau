import { clampScale, TOUCH_PAN_BLOCKER_SELECTOR, VIEWPORT, type Gesture, type ViewportState } from "./viewport-model.ts";

type MutableRef<T> = { current: T };

export type TouchGestureHandlers = {
  handleTouchStart: (e: TouchEvent) => void;
  handleTouchMove: (e: TouchEvent) => void;
  handleTouchEnd: (e: TouchEvent) => void;
  handleTouchCancel: () => void;
};

export function createTouchGestureHandlers({
  applyTransform,
  clampPan,
  container,
  didPan,
  enterPinch,
  gesture,
  resetGesture,
  startPan,
  state,
}: {
  applyTransform: () => void;
  clampPan: () => void;
  container: HTMLDivElement;
  didPan: MutableRef<boolean>;
  enterPinch: (t1: Touch, t2: Touch) => void;
  gesture: MutableRef<Gesture>;
  resetGesture: () => void;
  startPan: (source: "pointer" | "touch", clientX: number, clientY: number, pointerId?: number) => void;
  state: MutableRef<ViewportState>;
}): TouchGestureHandlers {
  function isTouchPanBlocker(target: HTMLElement) {
    return !!target.closest(TOUCH_PAN_BLOCKER_SELECTOR);
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length >= 2) {
      enterPinch(e.touches[0], e.touches[1]);
      return;
    }
    if (e.touches.length !== 1 || gesture.current.kind !== "idle") {
      return;
    }
    didPan.current = false;
    if (state.current.scale <= VIEWPORT.ZOOM_EPSILON) {
      return;
    }
    const touch = e.touches[0];
    const target = touch.target as HTMLElement | null;
    if (target && isTouchPanBlocker(target)) {
      return;
    }
    startPan("touch", touch.clientX, touch.clientY);
  }

  function handleTouchMove(e: TouchEvent) {
    const currentGesture = gesture.current;
    if (currentGesture.kind === "pinching" && e.touches.length >= 2) {
      e.preventDefault();
      const firstTouch = e.touches[0];
      const secondTouch = e.touches[1];
      const dist = Math.hypot(secondTouch.clientX - firstTouch.clientX, secondTouch.clientY - firstTouch.clientY);
      const rect = container.getBoundingClientRect();
      const newMidX = (firstTouch.clientX + secondTouch.clientX) / 2 - rect.left;
      const newMidY = (firstTouch.clientY + secondTouch.clientY) / 2 - rect.top;

      const newScale = currentGesture.initial.scale * (dist / currentGesture.startDist);
      const clamped = clampScale(newScale);
      const scaleRatio = clamped / currentGesture.initial.scale;

      state.current.x = newMidX - scaleRatio * (currentGesture.initialMidX - currentGesture.initial.x);
      state.current.y = newMidY - scaleRatio * (currentGesture.initialMidY - currentGesture.initial.y);
      state.current.scale = clamped;
      clampPan();
      applyTransform();
      return;
    }
    if (currentGesture.kind === "panning" && currentGesture.source === "touch" && e.touches.length === 1) {
      const touch = e.touches[0];
      const dx = touch.clientX - currentGesture.startX;
      const dy = touch.clientY - currentGesture.startY;
      if (!currentGesture.committed) {
        if (Math.abs(dx) < VIEWPORT.PAN_THRESHOLD && Math.abs(dy) < VIEWPORT.PAN_THRESHOLD) {
          return;
        }
        currentGesture.committed = true;
        didPan.current = true;
      }
      if (e.cancelable) {
        e.preventDefault();
      }
      state.current.x = currentGesture.initialSX + dx;
      state.current.y = currentGesture.initialSY + dy;
      clampPan();
      applyTransform();
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    const currentGesture = gesture.current;
    if (currentGesture.kind === "pinching") {
      if (e.touches.length < 2) {
        resetGesture();
      } else {
        enterPinch(e.touches[0], e.touches[1]);
      }
      return;
    }
    if (currentGesture.kind === "panning" && currentGesture.source === "touch" && e.touches.length === 0) {
      resetGesture();
    }
  }

  function handleTouchCancel() {
    const currentGesture = gesture.current;
    if (currentGesture.kind === "pinching" || (currentGesture.kind === "panning" && currentGesture.source === "touch")) {
      resetGesture();
    }
  }

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
  };
}
