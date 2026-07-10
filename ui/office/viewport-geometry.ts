import { clampScale, VIEWPORT, type ViewportState } from "./viewport-model.ts";

export interface SceneBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Measure scene content bounds in viewport-layer-local coords (pre-zoom), by
 * inverting the currently rendered transform.
 */
export function measureSceneBounds(container: HTMLDivElement, content: HTMLDivElement, state: ViewportState): SceneBounds | null {
  const crect = container.getBoundingClientRect();
  const rect = content.getBoundingClientRect();
  if (crect.width === 0 || crect.height === 0 || rect.width === 0 || rect.height === 0) {
    return null;
  }

  const { x, y, scale } = state;
  return {
    left: (rect.left - crect.left - x) / scale,
    right: (rect.right - crect.left - x) / scale,
    top: (rect.top - crect.top - y) / scale,
    bottom: (rect.bottom - crect.top - y) / scale,
  };
}

export function clampPanToBounds(state: ViewportState, container: HTMLDivElement, bounds: SceneBounds) {
  const { scale } = state;
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const maxX = (1 - VIEWPORT.PAN_MARGIN) * cw - scale * bounds.left;
  const minX = VIEWPORT.PAN_MARGIN * cw - scale * bounds.right;
  const maxY = (1 - VIEWPORT.PAN_MARGIN) * ch - scale * bounds.top;
  const minY = VIEWPORT.PAN_MARGIN * ch - scale * bounds.bottom;

  state.x = Math.max(minX, Math.min(maxX, state.x));
  state.y = Math.max(minY, Math.min(maxY, state.y));
}

export function zoomStateAt(state: ViewportState, cx: number, cy: number, newScale: number) {
  const clamped = clampScale(newScale);
  const ratio = clamped / state.scale;
  state.x = cx - ratio * (cx - state.x);
  state.y = cy - ratio * (cy - state.y);
  state.scale = clamped;
}
