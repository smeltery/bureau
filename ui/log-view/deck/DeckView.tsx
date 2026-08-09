import { useEffect, useMemo, useState } from "react";
import type { AgentInfo, LogEntry } from "../../../shared/types.ts";
import { buildDeckTurns, restoredDeckPos, settledDeckPos } from "../../../shared/slide-turns.ts";
import { getSlidePos, setSlidePos } from "../../device-settings.ts";
import { useAppState } from "../../store.tsx";
import { SlideStage } from "./SlideStage.tsx";
import { useDeckSlides } from "./useDeckSlides.ts";

// Slide Mode deck view.
//
// Renders the conversation as a deck - one position per assistant turn, 1:1 with
// the chat (placeholders included) - instead of the message list. Slides are
// model-generated, self-contained inline-styled HTML fragments rendered ONLY
// inside a sandboxed iframe with a restrictive CSP (shared/slide-frame.ts); the
// fragment never touches the app DOM. Nav with arrows (buttons + arrow keys), a
// counter, the turn's frozen prompt beneath each slide, and the chat view's own
// composer below that.
export function DeckView({ agent, logs, isMobile, inputBar }: { agent: AgentInfo; logs: LogEntry[]; isMobile: boolean; inputBar: React.ReactNode }) {
  const { hydrationEpoch } = useAppState();
  // Deck positions, in display order (timestamp; a stable sort keeps arrival order
  // on ties) - the same 1:1 mapping the server keys slides on.
  const turns = useMemo(() => buildDeckTurns([...logs].sort((a, b) => a.timestamp - b.timestamp)), [logs]);
  const [index, setIndex] = useState(() => restoredDeckPos(getSlidePos(agent.id), turns.length).index);
  const slides = useDeckSlides(agent.id, turns, index, hydrationEpoch);

  useEffect(() => {
    const pos = restoredDeckPos(getSlidePos(agent.id), turns.length);
    setIndex(pos.index);
    setSlidePos(agent.id, pos);
  }, [agent.id]);

  useEffect(() => {
    setIndex((cur) => {
      const prevLen = Math.max(1, turns.length - 1);
      const pos = settledDeckPos(cur, prevLen, turns.length);
      setSlidePos(agent.id, pos);
      return pos.index;
    });
  }, [agent.id, turns.length]);

  const turn = turns[index] ?? null;
  const slide = turn ? slides.state.slides.get(turn.entryId) : undefined;
  const failed = !!turn && slides.state.failed.has(turn.entryId);
  const atStart = index <= 0;
  const atEnd = index >= turns.length - 1;

  function jump(next: number) {
    const clamped = Math.min(Math.max(0, next), Math.max(0, turns.length - 1));
    setIndex(clamped);
    setSlidePos(agent.id, { index: clamped, atEnd: clamped >= turns.length - 1 });
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        jump(index - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        jump(index + 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        jump(0);
      } else if (event.key === "End") {
        event.preventDefault();
        jump(turns.length - 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, turns.length]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--bg-base)" }}>
      <section style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", justifyContent: "center", position: "relative", overflow: "hidden" }}>
        {turns.length === 0 ? (
          <div style={{ alignSelf: "center", color: "var(--text-muted)", fontSize: 14 }}>No conversation turns yet.</div>
        ) : (
          <SlideStage
            // Keyed by turn: the offscreen measurement and the fitted scale belong
            // to one slide's HTML, so navigating must start them over rather than
            // carry the previous slide's height into the next one.
            key={turn?.entryId}
            slide={slide}
            failed={failed}
            isNewest={atEnd}
            isMobile={isMobile}
            turn={turn ?? undefined}
            onRegen={(feedback) => turn && slides.regenerate(turn.entryId, feedback)}
          />
        )}
        <DeckButton label="Previous slide" side="left" disabled={atStart} isMobile={isMobile} onClick={() => jump(index - 1)} />
        <DeckButton label="Next slide" side="right" disabled={atEnd} isMobile={isMobile} onClick={() => jump(index + 1)} />
        {turns.length > 0 && (
          <div style={{ position: "absolute", bottom: isMobile ? 4 : 10, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ ...PILL_STYLE, color: "var(--text-muted)" }}>
              {index + 1} / {turns.length}
            </span>
            {!atEnd && (
              <button onClick={() => jump(turns.length - 1)} title="Jump to the latest slide (End)" style={{ ...PILL_STYLE, color: "var(--text-secondary)", cursor: "pointer" }}>
                Latest
              </button>
            )}
          </div>
        )}
      </section>
      <PromptBar promptText={turn?.promptText ?? ""} isMobile={isMobile} />
      {inputBar}
    </div>
  );
}

const PILL_STYLE: React.CSSProperties = {
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: 12,
  background: "var(--bg-overlay)",
  border: "1px solid var(--border-light)",
  borderRadius: 12,
  padding: "2px 10px",
};

// The turn's frozen prompt, beneath the slide. Rendered for EVERY position,
// including the newest: the stage above is flex:1, so a bar that appeared and
// disappeared as you navigated would resize the stage, rescale the slide and move
// the vertically-centred nav arrows. A FIXED height for the same reason - a longer
// prompt scrolls within the bar rather than growing it.
function PromptBar({ promptText, isMobile }: { promptText: string; isMobile: boolean }) {
  return (
    <div
      title="The prompt that produced this slide"
      style={{
        flexShrink: 0,
        borderTop: "1px solid var(--border-light)",
        padding: isMobile ? "8px 12px" : "12px 24px",
        background: "var(--bg-surface)",
        color: "var(--text-secondary)",
        fontSize: isMobile ? 12 : 14,
        lineHeight: 1.4,
        height: isMobile ? 44 : 68,
        boxSizing: "border-box",
        overflowY: "auto",
      }}
    >
      <span style={{ color: "var(--text-dim)", marginRight: 8 }}>Prompt:</span>
      {promptText}
    </div>
  );
}

function DeckButton({ label, side, disabled, isMobile, onClick }: { label: string; side: "left" | "right"; disabled: boolean; isMobile: boolean; onClick: () => void }) {
  const size = isMobile ? 30 : 38;
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        position: "absolute",
        top: "50%",
        [side]: isMobile ? 4 : 12,
        transform: "translateY(-50%)",
        width: size,
        height: size,
        borderRadius: 8,
        border: "1px solid var(--border-medium)",
        background: "var(--bg-overlay)",
        color: disabled ? "var(--text-ghost)" : "var(--text-primary)",
        opacity: disabled ? 0.35 : isMobile ? 0.75 : 0.9,
        cursor: disabled ? "default" : "pointer",
        fontSize: isMobile ? 16 : 22,
        lineHeight: isMobile ? "26px" : "34px",
      }}
    >
      {side === "left" ? "<" : ">"}
    </button>
  );
}
