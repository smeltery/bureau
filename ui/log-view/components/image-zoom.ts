// Zoom math for the chat's image viewer. The image keeps its fitted layout
// box and is drawn with `translate(x, y) scale(scale)` around the box's
// center, so every point here is an offset from the center of the window.

export interface ZoomView {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export const FIT: ZoomView = { scale: 1, x: 0, y: 0 };
export const ZOOM_STEP = 1.25;

// The most a viewer zooms: 4x, or twice the image's own pixels if more.
export function maxScale(natural: Size, fit: Size): number {
  return Math.max(4, (2 * natural.w) / Math.max(fit.w, 1));
}

// Where a click or double-tap goes: back to fit when zoomed, else the image's
// own pixels and at least 2x.
export function toggleScale(view: ZoomView, natural: Size, fit: Size): number {
  return view.scale > 1 ? 1 : Math.max(2, natural.w / Math.max(fit.w, 1));
}

// The view at nextScale (kept within [1, max]) that leaves the image point
// under `focal` where it was.
export function zoomAt(view: ZoomView, nextScale: number, focal: { x: number; y: number }, fit: Size, viewport: Size, max: number): ZoomView {
  const scale = Math.min(Math.max(nextScale, 1), max);
  const k = scale / view.scale;
  return clampPan({ scale, x: focal.x - k * (focal.x - view.x), y: focal.y - k * (focal.y - view.y) }, fit, viewport);
}

// The view moved by (dx, dy), kept so the image never leaves an edge gap.
export function panBy(view: ZoomView, dx: number, dy: number, fit: Size, viewport: Size): ZoomView {
  return clampPan({ ...view, x: view.x + dx, y: view.y + dy }, fit, viewport);
}

// An image smaller than the window stays centered on that axis; a larger one
// pans until its edge meets the window's.
export function clampPan(view: ZoomView, fit: Size, viewport: Size): ZoomView {
  const limit = (image: number, window: number) => Math.max(0, (image * view.scale - window) / 2);
  const clamp = (value: number, max: number) => Math.min(Math.max(value, -max), max);
  return { scale: view.scale, x: clamp(view.x, limit(fit.w, viewport.w)), y: clamp(view.y, limit(fit.h, viewport.h)) };
}
