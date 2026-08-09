import { useState } from "react";

import type { UsagePin } from "../../device-settings.ts";
import { AUTO_CHOICE_LABEL, CHOOSER_HINT, UNKNOWN_USAGE_TEXT, USAGE_CAVEAT, readingAgeLine, windowLine, type SubscriptionPillView } from "./subscription-pill-view.ts";

// The usage pill's popover. Lists every window the backend reports with its
// reset time and a countdown, marks the one the number comes from, and lets the
// viewer pin which limit the pill follows.
export function SubscriptionPillPopover({
  view,
  popoverId,
  coords,
  onChoose,
  popRef,
}: {
  view: SubscriptionPillView;
  popoverId: string;
  // Anchored to the button's viewport rect captured at open time — the header
  // and cwd row clip overflow, so the popover is positioned fixed. `atMs` is the
  // clock stamped at that same moment, which the "resets in ..." countdown and
  // the reading's age are measured against.
  coords: { top: number; right: number; atMs: number };
  onChoose: (pin: UsagePin | null) => void;
  popRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { reading, tracked } = view;
  const ageLine = readingAgeLine(reading, coords.atMs);
  return (
    <div
      ref={popRef}
      id={popoverId}
      // With a reading this is role="dialog", not role="tooltip": a tooltip is
      // non-interactive descriptive content, and the popover holds the limit
      // chooser's buttons. Without one there is nothing to choose, so it
      // degrades to the battery's plain descriptive tooltip.
      role={reading ? "dialog" : "tooltip"}
      aria-label={reading ? CHOOSER_HINT : undefined}
      style={{
        position: "fixed",
        top: coords.top,
        right: coords.right,
        zIndex: 1000,
        maxWidth: 280,
        padding: "8px 10px",
        background: "var(--bg-surface-solid)",
        border: "1px solid var(--border-medium)",
        borderRadius: 6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
        color: "var(--text-secondary)",
        fontSize: 12,
        lineHeight: 1.4,
        fontWeight: 400,
        whiteSpace: "normal",
      }}
    >
      {reading && tracked ? (
        <>
          {view.planLine && <div>{view.planLine}</div>}
          <div style={{ marginTop: 4, color: "var(--text-dim)" }}>{CHOOSER_HINT}</div>
          {reading.windows.map((w, i) => {
            const line = windowLine(w, coords.atMs);
            return (
              <ChoiceRow
                key={i}
                text={i === tracked.index ? `• ${line}` : line}
                active={i === tracked.index}
                selected={tracked.pinned && i === tracked.index}
                onClick={() => onChoose({ label: w.label, index: i })}
              />
            );
          })}
          <ChoiceRow text={AUTO_CHOICE_LABEL} active={!tracked.pinned} selected={!tracked.pinned} onClick={() => onChoose(null)} />
          {ageLine && <div style={{ marginTop: 6, color: "var(--text-dim)" }}>{ageLine}</div>}
          <div style={{ marginTop: 6, color: "var(--text-dim)" }}>{USAGE_CAVEAT}</div>
        </>
      ) : (
        UNKNOWN_USAGE_TEXT
      )}
    </div>
  );
}

// One selectable line in the popover's chooser. `active` = this is the window
// the number currently comes from (bulleted and bold); `selected` = this is the
// viewer's explicit choice, which is what aria-pressed reports. The two differ
// on the auto path: a window can be driving the number without being pinned.
function ChoiceRow({ text, active, selected, onClick }: { text: string; active: boolean; selected: boolean; onClick: () => void }) {
  // Selection reads as an accent-tinted background (--bg-subtle was too faint
  // to notice); hovering tints the row so the rows read as clickable at all.
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-pressed={selected}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: selected ? "var(--accent-bg)" : hovered ? "var(--accent-hover)" : "none",
        border: "none",
        borderRadius: 4,
        padding: "2px 4px",
        margin: 0,
        cursor: "pointer",
        color: "inherit",
        font: "inherit",
        fontWeight: active ? 600 : 400,
        lineHeight: 1.4,
      }}
    >
      {text}
    </button>
  );
}
