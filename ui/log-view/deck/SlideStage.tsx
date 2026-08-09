import { useEffect, useRef, useState } from "react";
import type { DeckTurn } from "../../../shared/slide-turns.ts";
import type { SlideRecord } from "../../../shared/slides.ts";
import { buildSlideMeasureSrcDoc, buildSlideSrcDoc, slideDisplayHeight, SLIDE_H, SLIDE_W } from "../../../shared/slide-frame.ts";
import { spinnerLabel, stageKind, stageRegenerable } from "./deck-slides.ts";

// One rendered slide, its pending spinner, the no-answer placeholder, or the
// raw-answer fallback. All four framings share the same scaled, centred frame so
// scaling and centring never diverge between them.
export function SlideStage({
  slide,
  failed,
  isNewest,
  isMobile,
  turn,
  onRegen,
}: {
  slide: SlideRecord | undefined;
  failed: boolean;
  isNewest: boolean;
  isMobile: boolean;
  turn: DeckTurn | undefined;
  onRegen: (feedback?: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  // Natural content height of the current slide's HTML, measured offscreen at
  // width 1280 (see MeasureFrame). null until measured. Only used for the
  // model-HTML branch; placeholder/fallback are app-rendered and always fit.
  const [measuredH, setMeasuredH] = useState<number | null>(null);

  const kind = stageKind(slide, failed, !!turn);
  // The height the slide is laid out at. Model HTML taller than the 720 canvas is
  // rendered at its natural height (see slideDisplayHeight) and scaled down whole,
  // so it is never clipped and never scrolls; shorter content keeps the 720 card.
  // Placeholder/fallback are app-rendered and always use 720.
  const contentH = kind === "html" ? slideDisplayHeight(measuredH) : SLIDE_H;

  // Re-fit whenever the pane resizes OR the measured height arrives/changes, so an
  // overfull slide reflows from the provisional 720 to its true height.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const recompute = () => {
      const rect = el.getBoundingClientRect();
      // Mobile renders edge to edge: a phone has no screen real estate to spend on
      // a margin, so the slide's scale is limited only by the viewport. Desktop
      // keeps the breathing room around the card.
      const pad = isMobile ? 0 : 24;
      const next = Math.min((rect.width - pad * 2) / SLIDE_W, (rect.height - pad * 2) / contentH);
      setScale(next > 0 ? next : 0.1);
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [contentH, isMobile]);

  // Wrap a natural-size (1280 x h) node in the scaled, centred frame.
  const frame = (inner: React.ReactNode, height: number = SLIDE_H) => (
    <div style={{ width: SLIDE_W * scale, height: height * scale }}>
      <div style={{ width: SLIDE_W, height, transform: `scale(${scale})`, transformOrigin: "top left" }}>{inner}</div>
    </div>
  );

  let body: React.ReactNode;
  if (kind === "placeholder" && slide) {
    body = frame(<PlaceholderInner slide={slide} />);
  } else if (kind === "html" && slide?.html) {
    body = (
      <>
        {/* Offscreen sizing pass - reads natural height, renders nothing. */}
        <MeasureFrame html={slide.html} onMeasured={setMeasuredH} />
        {frame(
          <iframe
            title="slide"
            sandbox=""
            srcDoc={buildSlideSrcDoc(slide.html, contentH)}
            width={SLIDE_W}
            height={contentH}
            style={{
              border: 0,
              // At full bleed the card framing has nothing to sit against, so the
              // rounding and shadow just eat pixels at the edges.
              borderRadius: isMobile ? 0 : 8,
              boxShadow: isMobile ? "none" : "0 8px 40px rgba(0,0,0,0.45)",
              background: "#0f1117",
            }}
          />,
          contentH,
        )}
      </>
    );
  } else if (kind === "fallback" && turn) {
    body = frame(<FallbackInner turn={turn} />);
  } else {
    body = <Spinner label={spinnerLabel(isNewest)} />;
  }

  return (
    <div ref={stageRef} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, minHeight: 0, position: "relative", overflow: "hidden" }}>
      {body}
      {stageRegenerable(kind) && <RegenControl onRegen={onRegen} />}
    </div>
  );
}

// Offscreen iframe that measures a slide's natural content height at width 1280 so
// the display frame can be sized to never clip.
//
// SECURITY: the DISPLAY iframe stays sandbox="" (opaque origin, fully isolated).
// Only THIS measurement copy adds sandbox="allow-same-origin", purely so the
// parent can read contentDocument.scrollHeight. That does NOT weaken the
// model-HTML boundary:
//   - No script can run: allow-scripts is absent AND the CSP is script-src 'none'
//     (defense in depth) - even a prompt-injected <script> is inert.
//   - No network: the CSP's default-src 'none' (img/font/connect/... 'none')
//     blocks every subresource and fetch, identical to the display frame.
//   - allow-same-origin only grants the PARENT read access to a script-dead,
//     network-dead document. With no script, the framed HTML cannot touch the
//     parent's origin, storage, or cookies. The parent merely reads a number.
// The frame is inert and offscreen (hidden, non-interactive) and is destroyed when
// the slide changes (SlideStage is keyed by entryId).
function MeasureFrame({ html, onMeasured }: { html: string; onMeasured: (h: number) => void }) {
  return (
    <iframe
      aria-hidden="true"
      tabIndex={-1}
      title="slide measurement"
      sandbox="allow-same-origin"
      srcDoc={buildSlideMeasureSrcDoc(html)}
      width={SLIDE_W}
      height={SLIDE_H}
      style={{ position: "absolute", left: -99999, top: 0, width: SLIDE_W, height: SLIDE_H, border: 0, visibility: "hidden", pointerEvents: "none" }}
      onLoad={(e) => {
        // Same-origin (allow-same-origin) so contentDocument is readable. If it is
        // somehow null we leave the default 720 in place (graceful: the slide
        // renders as before, no crash).
        const doc = e.currentTarget.contentDocument;
        if (!doc) return;
        const height = Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0);
        if (height > 0) onMeasured(height);
      }}
    />
  );
}

// The per-slide regenerate button + optional feedback field.
function RegenControl({ onRegen }: { onRegen: (feedback?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const submit = () => {
    onRegen(feedback.trim() || undefined);
    setFeedback("");
    setOpen(false);
  };
  return (
    <div style={{ position: "absolute", top: 10, right: 12, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Regenerate this slide"
        style={{
          background: "var(--bg-overlay)",
          border: "1px solid var(--border-medium)",
          borderRadius: 6,
          color: "var(--text-secondary)",
          fontSize: 15,
          lineHeight: 1,
          padding: "4px 8px",
          cursor: "pointer",
        }}
      >
        {"↻"}
      </button>
      {open && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What to change (optional)"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setOpen(false);
            }}
            style={{
              width: 220,
              background: "var(--bg-surface)",
              border: "1px solid var(--border-medium)",
              borderRadius: 6,
              color: "var(--text-primary)",
              fontSize: 12,
              padding: "5px 8px",
              outline: "none",
            }}
          />
          <button onClick={submit} style={{ background: "var(--accent)", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, padding: "5px 10px", cursor: "pointer" }}>
            Redo
          </button>
        </div>
      )}
    </div>
  );
}

// Placeholder position: an empty / interrupted / tool-only turn. Natural size
// (1280x720); the parent's frame() applies the scale.
function PlaceholderInner({ slide }: { slide: SlideRecord }) {
  return (
    <div
      style={{
        width: SLIDE_W,
        height: SLIDE_H,
        borderRadius: 8,
        background: "#14161c",
        border: "1px solid var(--border-light)",
        color: "#9aa3b2",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: 72,
        boxSizing: "border-box",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 30, color: "#e8eaf0", fontWeight: 600 }}>{slide.errorText ? "Turn failed" : "No answer to show"}</div>
      <div style={{ fontSize: 22, lineHeight: 1.4, maxWidth: 820 }}>{slide.errorText ? slide.errorText : "This turn produced no text (interrupted, or tool-only)."}</div>
    </div>
  );
}

// Shown when the server reported the generation as failed (or that there is no
// live turn to render): the raw answer on a plain template, so the viewer still
// gets the content. Regenerate stays available via the control above.
function FallbackInner({ turn }: { turn: DeckTurn }) {
  return (
    <div
      style={{
        width: SLIDE_W,
        height: SLIDE_H,
        borderRadius: 8,
        background: "#14161c",
        border: "1px solid var(--border-light)",
        color: "#e8eaf0",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: 72,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div style={{ fontSize: 22, color: "#9aa3b2" }}>Slide unavailable - showing the raw answer</div>
      <div style={{ fontSize: 24, lineHeight: 1.5, whiteSpace: "pre-wrap", overflow: "hidden" }}>{turn.assistantText.slice(0, 1200)}</div>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, color: "var(--text-muted)" }}>
      <div style={{ width: 34, height: 34, border: "3px solid var(--border-light)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ fontSize: 13 }}>{label}</div>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}
