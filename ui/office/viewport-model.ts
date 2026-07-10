export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

/** All numeric knobs for the viewport. Grouped so they're easy to find and tune. */
export const VIEWPORT = {
  MIN_SCALE: 0.5,
  MAX_SCALE: 2.5,
  /** Epsilon above 1.0 used to decide "zoomed in". Avoids floating-point drift from wheel scrolls just above rest. */
  ZOOM_EPSILON: 1.01,
  /** Pixels of pointer movement before a mousedown becomes a pan. */
  PAN_THRESHOLD: 5,
  /** Scale factor applied per wheel-pixel delta. */
  WHEEL_ZOOM_SPEED: 0.001,
  /** Zoom multiplier for +/- button or keyboard shortcuts. */
  ZOOM_STEP: 1.25,
  /** Fraction of the container that must remain occupied by the scene at the edge. */
  PAN_MARGIN: 0.25,
  RESET_TRANSITION: "transform 0.25s ease-out",
  RESET_CLEAR_MS: 300,
} as const;

export const DEFAULT_STATE: ViewportState = { x: 0, y: 0, scale: 1 };

// Pan should start from any non-interactive surface in the scene. Every clickable
// target in the scene — including native HTML5 drag sources like DeskUnit — opts
// out via `data-no-pan`, so we don't need a separate [draggable] rule here.
export const PAN_BLOCKER_SELECTOR = "[data-no-pan], button, a, input, textarea, select";

// Touch-only blocker: excludes [data-no-pan]. The big 180×160 desk/slot
// hit-rects blanket the visible floor — treating them as pan blockers would make
// one-finger pan fail almost everywhere when zoomed in. Tap-vs-drag stays safe
// because: (a) DeskUnit preventDefaults touchstart and dispatches its own
// clicks from touchend, so browser-synthesized clicks on a desk aren't the
// trigger path; (b) EmptySlot and other data-no-pan click targets rely on
// synthesized clicks, and wrapClick + didPan gate those on idle gestures.
export const TOUCH_PAN_BLOCKER_SELECTOR = "button, a, input, textarea, select";

export function clampScale(scale: number) {
  return Math.max(VIEWPORT.MIN_SCALE, Math.min(VIEWPORT.MAX_SCALE, scale));
}

/**
 * Explicit gesture state machine. Transitions:
 *   idle     → panning   (mouse/pen pointerdown OR single-finger touchstart
 *                         when zoomed in, both on a pannable target)
 *   panning  → idle      (pointerup | pointercancel | touchend | touchcancel)
 *   panning  → pinching  (second finger arrives; releases any captured pointer
 *                         so the remaining single touch after the pinch ends
 *                         doesn't reactivate a stale anchor)
 *   idle     → pinching  (two fingers land simultaneously)
 *   pinching → idle      (fingers drop below two | touchcancel)
 *
 * `source` distinguishes pan drivers: "pointer" pans are authoritatively owned
 * by a specific pointerId and use pointer capture; "touch" pans are driven by
 * TouchEvents (iOS Safari's pointer-event path is unreliable for sustained
 * single-finger drag — pointercancel fires even with touch-action: none, and
 * setPointerCapture on a touch pointer can drop pointermove deliveries).
 *
 * `panning.committed` distinguishes a pending tap (within the click threshold)
 * from an actual drag — uncommitted panning never mutates the viewport.
 */
export type Gesture =
  | { kind: "idle" }
  | {
      kind: "panning";
      source: "pointer" | "touch";
      pointerId: number; // unused when source === "touch"
      committed: boolean;
      startX: number;
      startY: number;
      initialSX: number;
      initialSY: number;
    }
  | {
      kind: "pinching";
      startDist: number;
      initial: ViewportState;
      initialMidX: number;
      initialMidY: number;
    };
