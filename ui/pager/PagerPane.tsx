import { useState } from "react";
import type { PagerEntry } from "../../shared/types.ts";
import { useAppState } from "../store.tsx";
import { sectionHeader } from "../components/AccessPane.tsx";
import { cardStyle, hint } from "../components/AccessPaneShared.tsx";
import { dialogInput, dialogSaveBtn } from "../components/modals/dialog-styles.ts";
import { PagerSettings } from "./PagerSettings.tsx";
import { usePager } from "./usePager.ts";

// Read once at load: a Discord link lands on /pager?page=<id>, and the
// settings route rewrites the URL before this pane mounts.
const linkedPageId = window.location.pathname.replace(/\/+$/, "") === "/pager" ? new URLSearchParams(window.location.search).get("page") : null;

const FAILURE_TEXT: Record<NonNullable<PagerEntry["delivery"]["failure"]>, string> = {
  no_webhook: "not delivered: no Discord webhook set",
  http_4xx: "Discord rejected the message",
  http_5xx: "Discord error, retrying",
  rate_limited: "rate limited by Discord, retrying",
  network: "could not reach Discord, retrying",
};

function age(ms: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function PagerPane() {
  const { rooms, currentRoom, lobbyOpen } = useAppState();
  const { pages, error, reload } = usePager();
  const [showResolved, setShowResolved] = useState(false);
  const [roomId, setRoomId] = useState(() => (linkedPageId || lobbyOpen ? "" : (rooms[currentRoom]?.id ?? "")));
  const [actionError, setActionError] = useState<string | null>(null);

  const visible = pages
    .filter((page) => showResolved || page.state !== "resolved" || page.id === linkedPageId)
    .filter((page) => !roomId || page.source.roomId === roomId)
    .sort((a, b) => Number(a.state !== "open") - Number(b.state !== "open") || b.lastRaisedAt - a.lastRaisedAt);

  async function act(page: PagerEntry, action: "ack" | "resolve") {
    setActionError(null);
    const res = await fetch(`/api/pager/${encodeURIComponent(page.id)}/${action}`, { method: "POST" });
    if (!res.ok) setActionError(((await res.json().catch(() => ({}))) as { error?: string }).error || `Could not ${action} the page`);
    await reload();
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>Pager</h4>
      <p style={hint}>Agents and apps page you here when something needs a person. Ack a page to stop the repeats; resolve it when it is dealt with. Resolved pages remain in your history.</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ ...dialogInput, width: "auto" }}>
          <option value="">All rooms</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved
        </label>
      </div>
      {(error || actionError) && <p style={{ fontSize: 11, color: "#ff6b6b" }}>{actionError ?? error}</p>}
      {visible.length === 0 ? (
        <p style={hint}>No pages.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {visible.map((page) => {
            const room = rooms.find((r) => r.id === page.source.roomId)?.name;
            const failure = page.delivery.failure ? FAILURE_TEXT[page.delivery.failure] : page.delivery.sends > 0 ? `sent ${page.delivery.sends}×` : null;
            return (
              <div key={page.id} style={{ ...cardStyle, outline: page.id === linkedPageId ? "2px solid var(--accent)" : undefined, opacity: page.state === "resolved" ? 0.6 : 1 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", justifyContent: "space-between" }}>
                  <strong style={{ fontSize: 13 }}>{page.title}</strong>
                  <span style={{ fontSize: 10, textTransform: "uppercase", color: page.state === "open" ? "var(--red, #f85149)" : "var(--text-ghost)" }}>{page.state}</span>
                </div>
                {page.body && <p style={{ fontSize: 12, whiteSpace: "pre-wrap", margin: "6px 0", color: "var(--text-secondary)" }}>{page.body}</p>}
                <div style={{ fontSize: 11, color: "var(--text-ghost)" }}>
                  {page.source.kind === "app" ? "App " : ""}
                  {page.source.name}
                  {room ? ` in ${room}` : ""} · {age(page.lastRaisedAt)}
                  {page.raiseCount > 1 ? ` · raised ${page.raiseCount}×` : ""}
                  {failure ? ` · ${failure}` : ""}
                  {page.ackedBy && page.state === "acked" ? ` · acked by ${page.ackedBy}` : ""}
                  {page.resolvedBy ? ` · resolved by ${page.resolvedBy}` : ""}
                </div>
                {page.state !== "resolved" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    {page.state === "open" && (
                      <button onClick={() => void act(page, "ack")} style={dialogSaveBtn}>
                        Ack
                      </button>
                    )}
                    <button onClick={() => void act(page, "resolve")} style={{ ...dialogSaveBtn, background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ marginTop: 24 }}>
        <PagerSettings />
      </div>
    </div>
  );
}
