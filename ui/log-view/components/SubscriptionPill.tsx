import { useEffect, useId, useRef, useState } from "react";

import type { AgentState } from "../../../shared/types.ts";
import { getUsagePin, setUsagePin, type UsagePin } from "../../device-settings.ts";
import { SubscriptionPillPopover } from "./SubscriptionPillPopover.tsx";
import { subscriptionPillView } from "./subscription-pill-view.ts";
import { useSubscriptionUsage, useSubscriptionUsageRefreshOnTurnEnd } from "./useSubscriptionUsage.ts";

// Subscription-allowance indicator, rendered immediately left of the context
// battery. See subscription-pill-view.ts for what it means and why it always
// renders (showing "?" until a reading arrives) instead of disappearing.
//
// One deliberate difference from the battery: it fills UP as usage grows, where
// the battery drains DOWN, and it's a ring rather than a battery shell — two
// same-shaped meters with opposite polarity sitting side by side would be a
// trap. The colour bands are shared with the battery on purpose (contextMeterColor:
// < 50 dim, 50-74 orange, >= 75 red), keyed off the used percentage.

// Circle geometry for the ring gauge, in the 24x24 viewBox.
const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function SubscriptionPill({
  agentId,
  provider,
  state,
  isMobile,
}: {
  // agentId and provider are the pin's storage key — see getUsagePin. `provider`
  // is the agent's engine, so a pin never crosses from one provider's windows to
  // another's.
  agentId: string;
  provider: string;
  // Drives the turn-boundary refresh: a plan number can only have moved once a
  // turn ends.
  state: AgentState;
  isMobile?: boolean;
}) {
  const { usage, refresh } = useSubscriptionUsage(agentId);
  useSubscriptionUsageRefreshOnTurnEnd(state, refresh);
  const [open, setOpen] = useState(false);
  // Mirror of the stored pin, seeded once from localStorage. The header keys
  // this component on agent + provider, so an agent or engine switch REMOUNTS it
  // and this initializer re-runs — no prop-into-state effect to keep in sync.
  const [pin, setPin] = useState<UsagePin | null>(() => getUsagePin(agentId, provider));
  // Stable id so the trigger's aria-controls points at the popover.
  const popoverId = useId();
  const [coords, setCoords] = useState<{ top: number; right: number; atMs: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const popoverOpen = open && coords !== null;

  // Dismiss on outside pointer / Escape (the popover is not a DOM descendant
  // of the button, so both refs are checked).
  useEffect(() => {
    if (!popoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  const view = subscriptionPillView(usage, pin);
  const dash = (RING_CIRCUMFERENCE * view.rawUsed) / 100;

  const choose = (next: UsagePin | null) => {
    setUsagePin(agentId, provider, next);
    setPin(next);
  };

  const toggle = () => {
    const next = !open;
    if (next && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setCoords({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right), atMs: Date.now() });
      // An explicit "tell me now" from the viewer.
      refresh();
    }
    setOpen(next);
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, color: view.color }}>
      <button
        ref={btnRef}
        onClick={toggle}
        title={isMobile ? undefined : view.tooltip}
        aria-label={view.ariaLabel}
        aria-expanded={popoverOpen}
        aria-controls={popoverOpen ? popoverId : undefined}
        data-testid="subscription-pill"
        style={{
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1,
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          cursor: "pointer",
          color: "inherit",
          lineHeight: 1,
        }}
      >
        <svg width={11} height={11} viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
          {/* track. With no reading the ring is the only mark left, so it
              carries a bit more weight than the track behind a real arc —
              matching how the battery's empty shell stays legible. */}
          <circle cx={12} cy={12} r={RING_RADIUS} fill="none" stroke="currentColor" strokeWidth={5} opacity={view.reading ? 0.3 : 0.55} />
          {/* used arc, starting at 12 o'clock and filling clockwise */}
          {view.rawUsed > 0 && (
            <circle cx={12} cy={12} r={RING_RADIUS} fill="none" stroke="currentColor" strokeWidth={5} strokeDasharray={`${dash} ${RING_CIRCUMFERENCE - dash}`} transform="rotate(-90 12 12)" />
          )}
        </svg>
        <span
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 10,
            fontWeight: 600,
            color: "inherit",
            whiteSpace: "nowrap",
            lineHeight: 1,
          }}
        >
          {view.label}
        </span>
      </button>
      {popoverOpen && <SubscriptionPillPopover view={view} popoverId={popoverId} coords={coords} onChoose={choose} popRef={popRef} />}
    </span>
  );
}
