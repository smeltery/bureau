import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useI18n } from "../../i18n.tsx";
import { FIT, maxScale, panBy, toggleScale, zoomAt, ZOOM_STEP, type Size, type ZoomView } from "./image-zoom.ts";

const DRAG_SLOP = 4;
const DOUBLE_TAP_MS = 300;

const toolButton = {
  minWidth: 32,
  height: 28,
  padding: "0 8px",
  border: "1px solid rgba(255,255,255,0.25)",
  borderRadius: 6,
  background: "rgba(0,0,0,0.55)",
  color: "#fff",
  fontSize: 13,
  cursor: "pointer",
} as const;

// A chat image at full size. The page itself does not pinch-zoom (the office
// pinches on its own), so the viewer zooms the image: wheel, pinch, a click or
// double-tap, the + − 0 keys, or the buttons; a zoomed image drags to pan.
// Escape or a click outside the image closes it.
export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const { t } = useI18n();
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<ZoomView>(FIT);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, pinchDistance: 0, pinchScale: 1, lastTap: 0 });

  const sizes = () => {
    const img = imgRef.current;
    const fit: Size = { w: img?.offsetWidth || 1, h: img?.offsetHeight || 1 };
    const natural: Size = { w: img?.naturalWidth || fit.w, h: img?.naturalHeight || fit.h };
    return { fit, natural, viewport: { w: window.innerWidth, h: window.innerHeight } };
  };
  const focalOf = (clientX: number, clientY: number) => ({ x: clientX - window.innerWidth / 2, y: clientY - window.innerHeight / 2 });
  const zoomTo = (scale: number, focal = { x: 0, y: 0 }) => {
    const { fit, natural, viewport } = sizes();
    setView((current) => zoomAt(current, scale, focal, fit, viewport, maxScale(natural, fit)));
  };

  useEffect(() => setView(FIT), [src]);

  // Capture-phase keys, so the office's own Escape (back to the room) does
  // not fire while the viewer is open.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const scale = viewRef.current.scale;
      if (event.key === "Escape") onClose();
      else if (event.key === "+" || event.key === "=") zoomTo(scale * ZOOM_STEP);
      else if (event.key === "-") zoomTo(scale / ZOOM_STEP);
      else if (event.key === "0") setView(FIT);
      else return;
      event.preventDefault();
      event.stopPropagation();
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  // A non-passive wheel listener, so zooming does not also scroll the chat.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      zoomTo(viewRef.current.scale * Math.exp(-event.deltaY * 0.002), focalOf(event.clientX, event.clientY));
    }
    overlay.addEventListener("wheel", handleWheel, { passive: false });
    return () => overlay.removeEventListener("wheel", handleWheel);
  }, []);

  function pinchDistance() {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  function onPointerDown(event: ReactPointerEvent) {
    if (event.target !== imgRef.current) return;
    // Captured on the image, so a drag that ends outside it is still a pan and
    // its click does not reach the backdrop.
    imgRef.current?.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture.current.moved = pointers.current.size > 1;
    if (pointers.current.size === 2) {
      gesture.current.pinchDistance = pinchDistance();
      gesture.current.pinchScale = viewRef.current.scale;
    }
  }

  function onPointerMove(event: ReactPointerEvent) {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const scale = gesture.current.pinchScale * (pinchDistance() / (gesture.current.pinchDistance || 1));
      zoomTo(scale, focalOf((a!.x + b!.x) / 2, (a!.y + b!.y) / 2));
      return;
    }
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    if (!gesture.current.moved && Math.hypot(dx, dy) < DRAG_SLOP) {
      pointers.current.set(event.pointerId, last);
      return;
    }
    gesture.current.moved = true;
    const { fit, viewport } = sizes();
    setView((current) => panBy(current, dx, dy, fit, viewport));
  }

  function onPointerUp(event: ReactPointerEvent) {
    if (!pointers.current.delete(event.pointerId) || gesture.current.moved) {
      if (pointers.current.size === 0) gesture.current.moved = false;
      return;
    }
    // A touch zooms on a double-tap, so a single tap can still be a pan's start.
    if (event.pointerType === "touch") {
      const now = event.timeStamp;
      const isDouble = now - gesture.current.lastTap < DOUBLE_TAP_MS;
      gesture.current.lastTap = isDouble ? 0 : now;
      if (!isDouble) return;
    }
    const { fit, natural } = sizes();
    zoomTo(toggleScale(viewRef.current, natural, fit), focalOf(event.clientX, event.clientY));
  }

  const zoomed = view.scale > 1;
  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("chat.image.viewer")}
      onClick={(event) => event.target === event.currentTarget && onClose()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "zoom-out",
        touchAction: "none",
        overflow: "hidden",
      }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={t("chat.image.fullSize")}
        draggable={false}
        style={{
          maxWidth: "90vw",
          maxHeight: "90vh",
          borderRadius: zoomed ? 0 : 8,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          cursor: zoomed ? "grab" : "zoom-in",
          userSelect: "none",
        }}
      />
      <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>
        <button type="button" aria-label={t("chat.image.zoomOut")} style={toolButton} disabled={!zoomed} onClick={() => zoomTo(view.scale / ZOOM_STEP)}>
          −
        </button>
        <button type="button" aria-label={t("chat.image.fit")} style={toolButton} onClick={() => setView(FIT)}>
          {Math.round(view.scale * 100)}%
        </button>
        <button type="button" aria-label={t("chat.image.zoomIn")} style={toolButton} onClick={() => zoomTo(view.scale * ZOOM_STEP)}>
          +
        </button>
      </div>
    </div>
  );
}
