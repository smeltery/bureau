import { useRef, useState, useEffect, useCallback } from "react";
import { clampScale, DEFAULT_STATE, PAN_BLOCKER_SELECTOR, TOUCH_PAN_BLOCKER_SELECTOR, VIEWPORT, type Gesture, type ViewportState } from "./viewport-model.ts";
import { clampPanToBounds, measureSceneBounds as measureSceneBoundsFor, zoomStateAt, type SceneBounds } from "./viewport-geometry.ts";

/**
 * Hook that manages zoom/pan for the office scene. Attaches wheel, pointer,
 * and touch listeners to the container, and mutates the scene transform
 * directly to avoid React re-renders during gestures.
 *
 * View state is global (one viewport for all rooms). Rooms share an
 * identical isometric layout, so a zoom/pan set in one is the right one in
 * any other — preserving it across room switches matches user intent more
 * often than resetting would.
 *
 * `layoutKey` should change whenever the centered scene's static transform
 * changes (e.g. embed/isMobile/mobileScale flip) so the pan-clamp boundaries
 * re-measure. ResizeObserver only fires on container size changes and won't
 * notice transform-only updates.
 *
 * When `enabled` is false, gesture listeners are not attached (wheel, pointer,
 * touch, pinch all become no-ops) — used to disable zoom in embed mode where
 * the UI chrome and keyboard shortcuts are already hidden.
 *
 * Returns callback refs (`setContainer`, `setScene`, `setContent`) instead of
 * RefObjects — attach them via `ref={...}` on the corresponding elements.
 */
export function useViewport(layoutKey: string, enabled: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  /** The scene-content element inside the zoom/pan layer — measured for pan-clamp bounds. */
  const contentRef = useRef<HTMLDivElement | null>(null);
  // State mirror of containerRef so the listener-attachment effect re-runs when
  // the container node is (re)attached. Scene/content are only read from
  // handlers, so refs alone suffice for those.
  const [container, setContainerState] = useState<HTMLDivElement | null>(null);

  const setContainer = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    setContainerState(node);
  }, []);
  const setScene = useCallback((node: HTMLDivElement | null) => {
    sceneRef.current = node;
  }, []);
  const setContent = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
  }, []);

  const state = useRef<ViewportState>({ ...DEFAULT_STATE });
  const gesture = useRef<Gesture>({ kind: "idle" });
  /** Scene content bounds in viewport-layer-local coords (pre-zoom). Null until measured. */
  const sceneBounds = useRef<SceneBounds | null>(null);
  /** True if the most recent pointer gesture became a pan — used to suppress click-to-focus */
  const didPan = useRef(false);
  const resetClearTimer = useRef<number | null>(null);
  const restoreUserSelect = useRef<string | null>(null);

  function clearResetTransition() {
    const scene = sceneRef.current;
    if (scene && scene.style.transition) {
      scene.style.transition = "";
    }
    if (resetClearTimer.current !== null) {
      clearTimeout(resetClearTimer.current);
      resetClearTimer.current = null;
    }
  }

  /** Abandon any in-flight gesture: release pointer capture, restore cursor and
   *  body userSelect, clear didPan, and return the state machine to idle. Called
   *  when listeners detach (enabled toggle / unmount). */
  function abortAllGestures() {
    const g = gesture.current;
    if (g.kind === "panning" && g.source === "pointer") {
      const c = containerRef.current;
      if (c) {
        if (c.hasPointerCapture(g.pointerId)) {
          c.releasePointerCapture(g.pointerId);
        }
        c.style.cursor = "";
      }
    }
    if (restoreUserSelect.current !== null) {
      document.body.style.userSelect = restoreUserSelect.current;
      restoreUserSelect.current = null;
    }
    didPan.current = false;
    gesture.current = { kind: "idle" };
  }

  function applyTransform(animate = false) {
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    const { x, y, scale } = state.current;
    // Only touch scene.style.transition if one is currently set — otherwise
    // every pointermove would write a no-op. Reading the live style is the
    // source of truth; the reset timer is its companion (set together, cleared
    // together).
    clearResetTransition();
    if (animate) {
      scene.style.transition = VIEWPORT.RESET_TRANSITION;
      resetClearTimer.current = window.setTimeout(() => {
        scene.style.transition = "";
        resetClearTimer.current = null;
      }, VIEWPORT.RESET_CLEAR_MS);
    }
    scene.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  /**
   * Measure the scene content's bounding box in viewport-layer-local coords
   * (pre-zoom), by inverting the currently-rendered transform. Caller must
   * ensure state.current matches the last rendered transform — i.e. call
   * after applyTransform, not between a state mutation and its apply.
   */
  function measureSceneBounds() {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) {
      sceneBounds.current = null;
      return;
    }
    sceneBounds.current = measureSceneBoundsFor(container, content, state.current);
  }

  function clampPan() {
    const container = containerRef.current;
    const b = sceneBounds.current;
    if (!container || !b) {
      return;
    }
    clampPanToBounds(state.current, container, b);
  }

  function zoomAt(cx: number, cy: number, newScale: number) {
    zoomStateAt(state.current, cx, cy, newScale);
    clampPan();
    applyTransform();
  }

  // The callbacks below are `useCallback(..., [])` because every value they
  // reach — state, gesture, refs, and the in-body helpers (applyTransform,
  // zoomAt, measureSceneBounds, clampPan) — is stored in a ref or
  // reads through one. No render-scoped variable is closed over. If you add
  // a line here that captures component state or props, switch to refs or
  // add the dep; otherwise the callback will silently use stale values.
  // sceneBounds are layer-local (measureSceneBounds inverts the live transform),
  // so they're invariant under state changes — no need to re-measure after
  // resetting. At DEFAULT_STATE, clampPan is a no-op by construction.
  const resetView = useCallback((animate = true) => {
    state.current = { ...DEFAULT_STATE };
    applyTransform(animate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomIn = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    zoomAt(rect.width / 2, rect.height / 2, state.current.scale * VIEWPORT.ZOOM_STEP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomOut = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    zoomAt(rect.width / 2, rect.height / 2, state.current.scale / VIEWPORT.ZOOM_STEP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** True when the user has zoomed in past the rest scale — used to route one-finger drags
   *  to pan instead of swipe on touch (iOS-gallery pattern). */
  const isZoomedIn = useCallback(() => state.current.scale > VIEWPORT.ZOOM_EPSILON, []);

  /** Wrap a click handler so it's suppressed when the click was actually a drag-pan. */
  const wrapClick = useCallback(<A extends unknown[]>(cb: (...args: A) => void) => {
    return (...args: A) => {
      if (!didPan.current) {
        cb(...args);
      }
    };
  }, []);

  // Re-measure scene bounds when the centered scene's static transform
  // changes (embed/isMobile/mobileScale). ResizeObserver only catches
  // container size changes, not transform-only updates to inner content.
  useEffect(() => {
    measureSceneBounds();
    clampPan();
    applyTransform();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  // This effect's deps are `[container, enabled]`. The DOM handlers registered
  // below close over in-body helpers (applyTransform, zoomAt, clampPan, save,
  // measureSceneBounds). Those helpers are recreated on every render, but the
  // handlers captured here reference the version from the render when the
  // effect last ran — which is fine ONLY because every helper reaches state
  // through refs and closes over no render-scoped values. If you add a line
  // to any helper that captures props or useState values, either add the dep
  // here (and accept listener churn) or route the new value through a ref.
  useEffect(() => {
    if (!container || !enabled) {
      return;
    }
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

    function isTouchPanBlocker(target: HTMLElement) {
      return !!target.closest(TOUCH_PAN_BLOCKER_SELECTOR);
    }

    function releasePan(pointerId: number) {
      if (container!.hasPointerCapture(pointerId)) {
        container!.releasePointerCapture(pointerId);
      }
      container!.style.cursor = "";
      if (restoreUserSelect.current !== null) {
        document.body.style.userSelect = restoreUserSelect.current;
        restoreUserSelect.current = null;
      }
    }

    function enterPinch(t1: Touch, t2: Touch) {
      if (gesture.current.kind === "panning" && gesture.current.source === "pointer") {
        // Release the primary pointer's capture so lifting back to a single
        // touch after the pinch doesn't reactivate the old pan anchor.
        // Touch-driven pans don't use pointer capture — nothing to release.
        releasePan(gesture.current.pointerId);
      }
      const rect = container!.getBoundingClientRect();
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
      const rect = container!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      // Normalize deltaY to pixels so Firefox line-mode and page-mode wheels zoom at the same rate as pixel-mode.
      const lineHeight = 16;
      const unit = e.deltaMode === 1 ? lineHeight : e.deltaMode === 2 ? rect.height : 1;
      const delta = -e.deltaY * unit * VIEWPORT.WHEEL_ZOOM_SPEED;
      zoomAt(cx, cy, state.current.scale * (1 + delta));
    }

    function handlePointerDown(e: PointerEvent) {
      // Touch-driven pan is handled in handleTouchStart (TouchEvents are more
      // reliable than pointer events on iOS for sustained single-finger pan).
      // Reset didPan only for non-touch pointers here — touch resets happen in
      // handleTouchStart on a fresh single-finger tap.
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
      container!.setPointerCapture(e.pointerId);
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
        container!.style.cursor = "grabbing";
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
      // Safe to clear here: pointer capture retargets the synthesized click to
      // the container, not to any wrapClick'd descendant, so no stale-didPan
      // window exists for mouse pans. Reset anyway to make the invariant
      // (didPan is true only between commit and end-of-gesture) explicit.
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

    function handleTouchStart(e: TouchEvent) {
      if (e.touches.length >= 2) {
        enterPinch(e.touches[0], e.touches[1]);
        return;
      }
      if (e.touches.length !== 1 || gesture.current.kind !== "idle") {
        return;
      }
      // DeskUnit's touch handler preventDefaults, which suppresses the
      // synthesized pointerdown — reset didPan on a fresh tap so a post-pan
      // tap on a desk isn't swallowed by the pan's lingering flag.
      didPan.current = false;
      // One-finger touches at rest scale belong to the swipe-to-change-room
      // hook (iOS-gallery pattern). Once zoomed in, the user needs one-finger
      // pan to look around, so we take the gesture back.
      if (state.current.scale <= VIEWPORT.ZOOM_EPSILON) {
        return;
      }
      const t = e.touches[0];
      const tgt = t.target as HTMLElement | null;
      if (tgt && isTouchPanBlocker(tgt)) {
        return;
      }
      startPan("touch", t.clientX, t.clientY);
    }

    function handleTouchMove(e: TouchEvent) {
      const g = gesture.current;
      if (g.kind === "pinching" && e.touches.length >= 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const rect = container!.getBoundingClientRect();
        const newMidX = (t1.clientX + t2.clientX) / 2 - rect.left;
        const newMidY = (t1.clientY + t2.clientY) / 2 - rect.top;

        const newScale = g.initial.scale * (dist / g.startDist);
        const clamped = clampScale(newScale);
        const scaleRatio = clamped / g.initial.scale;

        // Zoom anchored at the current midpoint, pinning the scene point that
        // sat under the midpoint when the pinch began:
        //   new.x = newMid - r * (initialMid - initial.x)
        state.current.x = newMidX - scaleRatio * (g.initialMidX - g.initial.x);
        state.current.y = newMidY - scaleRatio * (g.initialMidY - g.initial.y);
        state.current.scale = clamped;
        clampPan();
        applyTransform();
        return;
      }
      if (g.kind === "panning" && g.source === "touch" && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - g.startX;
        const dy = t.clientY - g.startY;
        if (!g.committed) {
          if (Math.abs(dx) < VIEWPORT.PAN_THRESHOLD && Math.abs(dy) < VIEWPORT.PAN_THRESHOLD) {
            return;
          }
          g.committed = true;
          didPan.current = true;
        }
        // Only preventDefault once the pan has committed. On iOS, a
        // preventDefault on any touchmove suppresses the browser-synthesized
        // click — we want that suppression for a real drag, but not for a
        // tap whose finger trembled a few pixels inside PAN_THRESHOLD (e.g.
        // tapping an EmptySlot to spawn while zoomed in).
        if (e.cancelable) {
          e.preventDefault();
        }
        state.current.x = g.initialSX + dx;
        state.current.y = g.initialSY + dy;
        clampPan();
        applyTransform();
      }
    }

    function handleTouchEnd(e: TouchEvent) {
      const g = gesture.current;
      if (g.kind === "pinching") {
        if (e.touches.length < 2) {
          resetGesture();
        } else {
          // A finger lifted from a 3+ finger pinch, leaving two on-screen.
          // Re-anchor so startDist/initialMid match the remaining pair —
          // otherwise the next touchmove snaps scale/position using stale
          // anchors from the prior finger configuration.
          enterPinch(e.touches[0], e.touches[1]);
        }
        return;
      }
      if (g.kind === "panning" && g.source === "touch" && e.touches.length === 0) {
        // didPan is intentionally NOT cleared here — it must survive past the
        // iOS-synthesized click window so wrapClick can suppress the tap that
        // follows a drag-pan. The next fresh single-finger tap clears it in
        // handleTouchStart. Do not "unify" this with handlePointerUp's reset.
        resetGesture();
      }
    }

    function handleTouchCancel() {
      const g = gesture.current;
      // iOS palm rejection / system gesture can cancel mid-pan. Reset any
      // touch-driven gesture state unconditionally so the next fresh touch
      // starts clean. Pointer-driven pans live in handlePointerCancel.
      if (g.kind === "pinching" || (g.kind === "panning" && g.source === "touch")) {
        resetGesture();
      }
    }

    const ro = new ResizeObserver(() => {
      // The centered scene's layer-local position depends on container size.
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
    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handleTouchCancel, {
      passive: true,
    });

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
      // Must come AFTER removeEventListener calls: abortAllGestures releases
      // pointer capture, which can synthesize a pointercancel — we don't want
      // that dispatching into the handler we're about to remove.
      abortAllGestures();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, enabled]);

  return {
    setContainer,
    setScene,
    setContent,
    resetView,
    zoomIn,
    zoomOut,
    isZoomedIn,
    wrapClick,
  };
}
