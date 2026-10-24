import { useI18n } from "../i18n.tsx";
import { pagerRequest, pagerFailure, pagerFailureText, deliveryFailureText, pageAge, type PagerFailure } from "./feedback.ts";
import { QuestionsPane } from "../questions/QuestionsPane.tsx";
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

export function PagerPane({ onOpenAgent }: { onOpenAgent?: (id: string) => void }) {
  const { t, language } = useI18n();
  const { rooms, currentRoom, lobbyOpen } = useAppState();
  const [showResolved, setShowResolved] = useState(false);
  const [roomId, setRoomId] = useState(() => (linkedPageId || lobbyOpen ? "" : (rooms[currentRoom]?.id ?? "")));
  const [cursors, setCursors] = useState<string[]>([]);
  const { pages, error, reload, nextCursor, loading } = usePager(true, { roomId, includeResolved: showResolved, cursor: cursors.at(-1), linkedPageId });
  const [actionError, setActionError] = useState<PagerFailure | null>(null);

  const visible = pages
    .filter((page) => showResolved || page.state !== "resolved" || page.id === linkedPageId)
    .filter((page) => !roomId || page.source.roomId === roomId)
    .sort((a, b) => Number(a.state !== "open") - Number(b.state !== "open") || b.lastRaisedAt - a.lastRaisedAt);

  async function act(page: PagerEntry, action: "ack" | "resolve") {
    setActionError(null);
    try {
      await pagerRequest(`/api/pager/${encodeURIComponent(page.id)}/${action}`, { method: "POST" });
    } catch (error) {
      setActionError(pagerFailure(error, action === "ack" ? "pager.ackFailed" : "pager.resolveFailed"));
    }
    await reload();
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={sectionHeader}>{t("pager.inbox")}</h3>
      <QuestionsPane onOpenAgent={onOpenAgent} />
      <h4 style={sectionHeader}>{t("pager.urgent")}</h4>
      <p style={hint}>{t("pager.hint")}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "12px 0" }}>
        <select
          aria-label={t("pager.allRooms")}
          value={roomId}
          onChange={(e) => {
            setRoomId(e.target.value);
            setCursors([]);
          }}
          style={{ ...dialogInput, width: "auto" }}
        >
          <option value="">{t("pager.allRooms")}</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => {
              setShowResolved(e.target.checked);
              setCursors([]);
            }}
          />{" "}
          {t("pager.showResolved")}
        </label>
      </div>
      {(error || actionError) && <p style={{ fontSize: 11, color: "#ff6b6b" }}>{actionError ? pagerFailureText(actionError, t) : error}</p>}
      {visible.length === 0 ? (
        <p style={hint}>{t(loading ? "pager.loading" : "pager.empty")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {visible.map((page) => {
            const room = rooms.find((r) => r.id === page.source.roomId)?.name;
            const failure = page.delivery.failure
              ? deliveryFailureText(page.delivery.failure, t, true)
              : page.delivery.sends > 0
                ? t("pager.sent", { count: page.delivery.sends.toLocaleString(language) })
                : null;
            return (
              <div key={page.id} style={{ ...cardStyle, outline: page.id === linkedPageId ? "2px solid var(--accent)" : undefined, opacity: page.state === "resolved" ? 0.6 : 1 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", justifyContent: "space-between" }}>
                  <strong style={{ fontSize: 13 }}>{page.title}</strong>
                  <span style={{ fontSize: 10, textTransform: "uppercase", color: page.state === "open" ? "var(--red, #f85149)" : "var(--text-ghost)" }}>
                    {t(page.state === "open" ? "pager.state.open" : page.state === "acked" ? "pager.state.acked" : "pager.state.resolved")}
                  </span>
                </div>
                {page.body && <p style={{ fontSize: 12, whiteSpace: "pre-wrap", margin: "6px 0", color: "var(--text-secondary)" }}>{page.body}</p>}
                <div style={{ fontSize: 11, color: "var(--text-ghost)" }}>
                  {page.source.kind === "app" ? t("pager.app", { name: page.source.name }) : page.source.name}
                  {room ? ` ${t("pager.room", { room })}` : ""} · {pageAge(page.lastRaisedAt, language)}
                  {page.raiseCount > 1 ? ` · ${t("pager.raised", { count: page.raiseCount.toLocaleString(language) })}` : ""}
                  {failure ? ` · ${failure}` : ""}
                  {page.ackedBy && page.state === "acked" ? ` · ${t("pager.ackedBy", { name: page.ackedBy })}` : ""}
                  {page.resolvedBy ? ` · ${t("pager.resolvedBy", { name: page.resolvedBy })}` : ""}
                </div>
                {page.state !== "resolved" && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                    {page.state === "open" && (
                      <button onClick={() => void act(page, "ack")} style={dialogSaveBtn}>
                        {t("pager.ack")}
                      </button>
                    )}
                    <button onClick={() => void act(page, "resolve")} style={{ ...dialogSaveBtn, background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                      {t("pager.resolve")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {showResolved && (cursors.length > 0 || nextCursor) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {cursors.length > 0 && (
            <button disabled={loading} style={dialogSaveBtn} onClick={() => setCursors((previous) => previous.slice(0, -1))}>
              {t("pager.newer")}
            </button>
          )}
          {nextCursor && (
            <button disabled={loading} style={dialogSaveBtn} onClick={() => setCursors((previous) => [...previous, nextCursor])}>
              {t("pager.older")}
            </button>
          )}
        </div>
      )}
      <div style={{ marginTop: 24 }}>
        <PagerSettings />
      </div>
    </div>
  );
}
