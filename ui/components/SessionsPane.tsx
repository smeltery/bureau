import { useEffect, useRef, useState } from "react";
import { useAppState } from "../store.tsx";
import { addRawListener, removeRawListener, send } from "../ws.ts";
import { SessionsTable, renderListSection, sectionHeader } from "./AccessPane.tsx";
import { hint } from "./AccessPaneShared.tsx";

export function SessionsPane() {
  const { activeSessions, activeSessionsLoaded } = useAppState();
  const [blockedNote, setBlockedNote] = useState<string | null>(null);
  const prevSessionsLenRef = useRef<number>(activeSessions.length);

  useEffect(() => {
    if (!activeSessionsLoaded) send({ type: "list_active_sessions" });
  }, [activeSessionsLoaded]);

  useEffect(() => {
    const fn = (data: string) => {
      try {
        const m = JSON.parse(data);
        if (m.type === "revoke_blocked" && typeof m.reason === "string") {
          setBlockedNote(m.reason);
        }
      } catch {}
    };
    addRawListener(fn);
    return () => removeRawListener(fn);
  }, []);

  useEffect(() => {
    const prev = prevSessionsLenRef.current;
    const curr = activeSessions.length;
    prevSessionsLenRef.current = curr;
    if (curr < prev) setBlockedNote(null);
  }, [activeSessions.length]);

  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>Sessions</h4>
      <p style={hint}>Devices signed into this office, across all users. Revoking a session signs that device out.</p>

      {blockedNote && (
        <div style={blockedBox}>
          <span style={{ flex: 1 }}>{blockedNote}</span>
          <button
            onClick={() => setBlockedNote(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#ff6b6b",
              cursor: "pointer",
              fontSize: 14,
              padding: 0,
            }}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {renderListSection(activeSessions, activeSessionsLoaded, (rows) => (
        <SessionsTable sessions={rows} />
      ))}
    </div>
  );
}

const blockedBox: React.CSSProperties = {
  margin: "8px 0",
  padding: "8px 12px",
  border: "1px solid #ff6b6b",
  borderRadius: 6,
  background: "rgba(255,107,107,0.08)",
  fontSize: 12,
  color: "#ff6b6b",
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
};
