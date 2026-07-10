// Owner-only Access section: list outstanding invites + active sessions,
// issue new invites, revoke either, toggle external access. Mounts inside
// UserManagementModal when the current session's role is "owner".

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../store.tsx";
import { send, addRawListener, removeRawListener } from "../ws.ts";
import type { InviteWire, SessionWire, UserRecord, UserRole } from "../../shared/types.ts";
import { lowercaseKey } from "../../shared/identity.ts";
import { dialogInput, dialogSaveBtn } from "./modals/dialog-styles.ts";
import { InvitesTable, SessionsTable } from "./access-tables.tsx";
import { ExternalAccessSection } from "./ExternalAccessSection.tsx";
import { cardStyle, hint, MintedUrlBox, subLabel, subsectionHeader } from "./AccessPaneShared.tsx";
export { InvitesTable, SessionsTable } from "./access-tables.tsx";

export function AccessPane() {
  const { invitesList, invitesLoaded, activeSessions, activeSessionsLoaded } = useAppState();
  // Holds the most recent server-side lockout-prevention rejection so the
  // banner stays visible until the user dismisses or retries. Cleared on
  // any successful state change (which we proxy via activeSessions length
  // change — a successful revoke shrinks the list).
  const [blockedNote, setBlockedNote] = useState<string | null>(null);
  const prevSessionsLenRef = useRef<number>(activeSessions.length);

  // Lazily fetch the owner-only lists. The session_context reducer resets
  // both loaded flags on every WS open (including reconnects), so this
  // effect re-runs and keeps the lists fresh across socket bounces.
  useEffect(() => {
    if (!invitesLoaded) send({ type: "list_invites" });
    if (!activeSessionsLoaded) send({ type: "list_active_sessions" });
  }, [invitesLoaded, activeSessionsLoaded]);

  // Listen for the server's lockout-prevention rejections.
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

  // Auto-clear the banner on any successful active-session change.
  useEffect(() => {
    const prev = prevSessionsLenRef.current;
    const curr = activeSessions.length;
    prevSessionsLenRef.current = curr;
    if (curr < prev) setBlockedNote(null);
  }, [activeSessions.length]);

  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>Access</h4>
      <p style={hint}>Add owners and members here by issuing invite URLs and sending them to the recipient. Toggle external access if you want this office reachable from outside the host machine.</p>

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

      <ExternalAccessSection />

      <IssueInviteForm />

      <h5 style={subsectionHeader}>Outstanding invites</h5>
      {renderListSection(invitesList, invitesLoaded, (rows) => (
        <InvitesTable invites={rows} />
      ))}

      <h5 style={subsectionHeader}>Active sessions</h5>
      {renderListSection(activeSessions, activeSessionsLoaded, (rows) => (
        <SessionsTable sessions={rows} />
      ))}
    </div>
  );
}

// Render the cached rows whenever any are present, even while a refresh is
// in flight — avoids a flicker to "Loading…" on every reconnect.
export function renderListSection<T>(rows: T[], loaded: boolean, renderTable: (rows: T[]) => React.ReactNode): React.ReactNode {
  if (rows.length > 0) return renderTable(rows);
  if (!loaded) return <p style={hint}>Loading…</p>;
  return <p style={hint}>None.</p>;
}

function IssueInviteForm() {
  const { users } = useAppState();
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [allowExisting, setAllowExisting] = useState(false);
  const [mintedUrl, setMintedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingListenerRef = useRef<((data: string) => void) | null>(null);
  useEffect(() => {
    return () => {
      const fn = pendingListenerRef.current;
      if (fn) removeRawListener(fn);
    };
  }, []);

  // Existing-user detection uses the same lowercase key the server uses
  // (lowercaseKey, not raw toLowerCase) so unicode/whitespace handling
  // stays consistent across the two sides.
  const existingUser: UserRecord | null = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    return users.get(lowercaseKey(trimmed)) ?? null;
  }, [users, name]);
  const existing = existingUser !== null;
  // When the typed name matches an existing user, force the role to match
  // so the server's role_mismatch check doesn't fire at accept time.
  const effectiveRole: UserRole = existingUser ? existingUser.role : role;

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const reqId = `invite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setPending(true);
    setError(null);
    setMintedUrl(null);
    const listener = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "invite_minted" && msg.requestId === reqId) {
          setPending(false);
          removeRawListener(listener);
          pendingListenerRef.current = null;
          if (msg.ok) {
            setMintedUrl(msg.url);
            setName("");
            setAllowExisting(false);
          } else {
            setError(msg.error || "Failed to mint invite");
          }
        }
      } catch {}
    };
    pendingListenerRef.current = listener;
    addRawListener(listener);
    send({
      type: "mint_invite",
      requestId: reqId,
      username: trimmed,
      role: effectiveRole,
      allowExisting: existing ? allowExisting : false,
    });
  }

  return (
    <div style={cardStyle}>
      <label style={subLabel}>Issue invite for…</label>
      <input
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        placeholder="Username (e.g. Marc)"
        maxLength={64}
        style={dialogInput}
      />
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <label style={{ flex: 1 }}>
          <div style={subLabel}>Role</div>
          {existingUser ? (
            <div
              style={{
                ...dialogInput,
                display: "flex",
                alignItems: "center",
                color: "var(--text-dim)",
                background: "var(--bg-base)",
                fontSize: 12,
              }}
              title={`Role is fixed to match the existing ${existingUser.name} record. Use the change-role flow to promote/demote.`}
            >
              {existingUser.role}
              <span style={{ marginLeft: 6, color: "var(--text-hint)" }}>(matches existing user)</span>
            </div>
          ) : (
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} style={dialogInput}>
              <option value="member">member</option>
              <option value="owner">owner</option>
            </select>
          )}
        </label>
      </div>
      <p style={{ ...hint, marginTop: 6 }}>Invite link expires 24h after issuing if unused. Accepted sessions last up to 1 year (revocable from the Access pane any time).</p>
      {existing && (
        <label style={{ display: "flex", gap: 6, marginTop: 8, fontSize: 12 }}>
          <input type="checkbox" checked={allowExisting} onChange={(e) => setAllowExisting(e.target.checked)} />
          <span>
            User <b>{name}</b> already exists. Issue an additional invite for this identity (e.g. another device). Won't affect existing sessions or role.
          </span>
        </label>
      )}
      {error && <p style={{ fontSize: 11, color: "#ff6b6b", margin: "6px 0 0" }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          onClick={submit}
          disabled={pending || !name.trim() || (existing && !allowExisting)}
          style={{
            ...dialogSaveBtn,
            opacity: pending || !name.trim() || (existing && !allowExisting) ? 0.5 : 1,
          }}
        >
          {pending ? "Minting…" : "Issue invite"}
        </button>
      </div>
      {mintedUrl && <MintedUrlBox url={mintedUrl} />}
    </div>
  );
}

export const sectionHeader: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  margin: "0 0 4px",
  color: "var(--text-primary)",
};
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
