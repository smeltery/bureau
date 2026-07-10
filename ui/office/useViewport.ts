import { useRef, useState, useEffect, useCallback } from "react";
import { DEFAULT_STATE, VIEWPORT, type Gesture, type ViewportState } from "./viewport-model.ts";
import { clampPanToBounds, measureSceneBounds as measureSceneBoundsFor, zoomStateAt, type SceneBounds } from "./viewport-geometry.ts";
import { attachViewportGestures } from "./viewport-gestures.ts";

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
    return attachViewportGestures(
      container,
      {
        containerRef,
        state,
        gesture,
        sceneBounds,
        didPan,
        restoreUserSelect,
      },
      {
        clearResetTransition,
        abortAllGestures,
        applyTransform,
        measureSceneBounds,
        clampPan,
        zoomAt,
      },
    );
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
