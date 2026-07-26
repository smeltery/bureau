import { useEffect, useMemo, useState } from "react";
import type { AgentInfo, LogEntry } from "../../../shared/types.ts";
import { buildDeckTurns, restoredDeckPos, settledDeckPos } from "../../../shared/slide-turns.ts";
import { getSlidePos, setSlidePos } from "../../device-settings.ts";
import { Markdown } from "../Markdown.tsx";

export function DeckView({ agent, logs, isMobile, input, inputBar }: { agent: AgentInfo; logs: LogEntry[]; isMobile: boolean; input: string; inputBar: React.ReactNode }) {
  const turns = useMemo(() => buildDeckTurns(logs), [logs]);
  const [index, setIndex] = useState(() => restoredDeckPos(getSlidePos(agent.id), turns.length).index);

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
  const atStart = index <= 0;
  const atEnd = index >= turns.length - 1;

  function jump(next: number) {
    const clamped = Math.min(Math.max(0, next), Math.max(0, turns.length - 1));
    setIndex(clamped);
    setSlidePos(agent.id, { index: clamped, atEnd: clamped >= turns.length - 1 });
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") jump(index - 1);
      if (event.key === "ArrowRight") jump(index + 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, turns.length]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--bg-base)" }}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateRows: "1fr auto",
          padding: isMobile ? 0 : 20,
          gap: isMobile ? 0 : 14,
        }}
      >
        <section
          style={{
            minHeight: 0,
            display: "flex",
            alignItems: "stretch",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {turn ? (
            <article
              style={{
                width: "min(100%, 1280px)",
                aspectRatio: "16 / 9",
                maxHeight: "100%",
                alignSelf: "center",
                display: "grid",
                gridTemplateRows: "auto 1fr auto",
                padding: isMobile ? 18 : 42,
                boxSizing: "border-box",
                background: "linear-gradient(135deg, #171923, #20242f 48%, #13251f)",
                border: isMobile ? "none" : "1px solid var(--border-light)",
                borderRadius: isMobile ? 0 : 8,
                boxShadow: isMobile ? "none" : "0 18px 70px rgba(0,0,0,0.35)",
                color: "var(--text-primary)",
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }}>
                  {agent.name} / {index + 1} of {turns.length}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-ghost)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{turn.promptText}</div>
              </div>
              <div style={{ minHeight: 0, overflow: "hidden", display: "flex", alignItems: "center" }}>
                {turn.placeholder ? (
                  <div style={{ color: "var(--text-muted)", fontSize: isMobile ? 24 : 36, fontWeight: 650, lineHeight: 1.15 }}>
                    {turn.errorText ? "This turn ended with an error." : "No assistant answer in this turn yet."}
                  </div>
                ) : (
                  <div style={{ fontSize: isMobile ? 19 : 30, lineHeight: 1.22, width: "100%", maxHeight: "100%", overflow: "hidden" }}>
                    <Markdown content={turn.assistantText} />
                  </div>
                )}
              </div>
              <div style={{ fontSize: isMobile ? 11 : 13, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {input.trim() ? input.trim() : (turn.errorText ?? " ")}
              </div>
            </article>
          ) : (
            <div style={{ alignSelf: "center", color: "var(--text-muted)", fontSize: 14 }}>No conversation turns yet.</div>
          )}
          <DeckButton label="Previous slide" side="left" disabled={atStart} onClick={() => jump(index - 1)} />
          <DeckButton label="Next slide" side="right" disabled={atEnd} onClick={() => jump(index + 1)} />
        </section>
        {inputBar}
      </div>
    </div>
  );
}

function DeckButton({ label, side, disabled, onClick }: { label: string; side: "left" | "right"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        position: "absolute",
        top: "50%",
        [side]: 12,
        transform: "translateY(-50%)",
        width: 38,
        height: 38,
        borderRadius: 8,
        border: "1px solid var(--border-medium)",
        background: "var(--bg-overlay)",
        color: disabled ? "var(--text-ghost)" : "var(--text-primary)",
        opacity: disabled ? 0.35 : 0.9,
        cursor: disabled ? "default" : "pointer",
        fontSize: 22,
        lineHeight: "34px",
      }}
    >
      {side === "left" ? "<" : ">"}
    </button>
  );
}
