import { useI18n } from "../i18n.tsx";
import { accessFailureText, revokeFailure, type AccessFailure } from "./access/feedback.ts";
import { useEffect, useRef, useState } from "react";
import { useAppState } from "../store.tsx";
import { addRawListener, removeRawListener, send } from "../ws.ts";
import { SessionsTable, renderListSection, sectionHeader } from "./AccessPane.tsx";
import { hint } from "./AccessPaneShared.tsx";

export function SessionsPane() {
  const { t } = useI18n();
  const { activeSessions, activeSessionsLoaded } = useAppState();
  const [blockedNote, setBlockedNote] = useState<AccessFailure | null>(null);
  const prevSessionsLenRef = useRef<number>(activeSessions.length);

  useEffect(() => {
    if (!activeSessionsLoaded) send({ type: "list_active_sessions" });
  }, [activeSessionsLoaded]);

  useEffect(() => {
    const fn = (data: string) => {
      try {
        const m = JSON.parse(data);
        if (m.type === "revoke_blocked" && typeof m.reason === "string") {
          setBlockedNote(revokeFailure(m));
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
      <h4 style={sectionHeader}>{t("accessUi.sessions")}</h4>
      <p style={hint}>{t("accessUi.sessionsHint")}</p>

      {blockedNote && (
        <div style={blockedBox}>
          <span style={{ flex: 1 }}>{accessFailureText(blockedNote, t)}</span>
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
            title={t("accessUi.dismiss")}
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
