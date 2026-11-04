import { expect, test } from "bun:test";
import { clampPan, FIT, maxScale, panBy, toggleScale, zoomAt } from "./image-zoom.ts";

const fit = { w: 400, h: 300 };
const viewport = { w: 800, h: 600 };

test("zooming keeps the point under the cursor in place", () => {
  const view = zoomAt(FIT, 4, { x: 100, y: 50 }, fit, viewport, 4);
  expect(view).toEqual({ scale: 4, x: -300, y: -150 });
  // The image point under the cursor: (focal - x) / scale, the same before and after.
  expect((100 - view.x) / view.scale).toBe(100);
});

test("scale stays between fit and the maximum", () => {
  expect(zoomAt(FIT, 0.5, { x: 0, y: 0 }, fit, viewport, 4).scale).toBe(1);
  expect(zoomAt(FIT, 9, { x: 0, y: 0 }, fit, viewport, 4).scale).toBe(4);
});

test("panning stops at the image's edges", () => {
  // At 4x the image is 1600x1200: it may move 400 px across and 300 px down.
  const view = { scale: 4, x: 0, y: 0 };
  expect(panBy(view, 1000, -1000, fit, viewport)).toEqual({ scale: 4, x: 400, y: -300 });
  // At 2.5x the 1000 px wide image pans 100 px; the 750 px tall one 75 px.
  expect(clampPan({ scale: 2.5, x: 150, y: -200 }, fit, viewport)).toEqual({ scale: 2.5, x: 100, y: -75 });
  // At 1.5x the 600x450 image still fits the window: it stays centered.
  expect(clampPan({ scale: 1.5, x: 50, y: 20 }, fit, viewport)).toEqual({ scale: 1.5, x: 0, y: 0 });
});

test("a click zooms to the image's own pixels, and back", () => {
  const natural = { w: 1200, h: 900 };
  expect(toggleScale(FIT, natural, fit)).toBe(3);
  expect(toggleScale(FIT, { w: 400, h: 300 }, fit)).toBe(2);
  expect(toggleScale({ scale: 3, x: 0, y: 0 }, natural, fit)).toBe(1);
  expect(maxScale(natural, fit)).toBe(6);
  expect(maxScale({ w: 100, h: 50 }, { w: 100, h: 50 })).toBe(4);
});
