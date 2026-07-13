import { useEffect, useMemo, useRef, useState } from "react";
import type { UserRecord, UserRole } from "../../shared/types.ts";
import { lowercaseKey } from "../../shared/identity.ts";
import { useAppState } from "../store.tsx";
import { addRawListener, removeRawListener, send } from "../ws.ts";
import { dialogInput, dialogSaveBtn } from "./modals/dialog-styles.ts";
import { cardStyle, hint, MintedUrlBox, subLabel } from "./AccessPaneShared.tsx";

export function IssueInviteForm() {
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
