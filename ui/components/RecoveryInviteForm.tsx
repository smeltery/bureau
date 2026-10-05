import { useMemo, useState } from "react";
import type { InviteWire, UserRecord } from "../../shared/types.ts";
import { useAppState } from "../store.tsx";
import { dialogInput, dialogSaveBtn } from "./modals/dialog-styles.ts";
import { cardStyle, hint, MintedUrlBox, subLabel } from "./AccessPaneShared.tsx";

type RecoveryInviteResponse = {
  url: string;
  invite: InviteWire;
};

export function recoveryInviteUserOptions(users: Map<string, UserRecord>): UserRecord[] {
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function RecoveryInviteForm() {
  const { users } = useAppState();
  const [userId, setUserId] = useState("");
  const [mintedUrl, setMintedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const userOptions = useMemo(() => recoveryInviteUserOptions(users), [users]);

  async function submit() {
    if (!userId) return;
    setPending(true);
    setError(null);
    setMintedUrl(null);
    try {
      const res = await fetch("/api/invites/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ userId }),
      });
      const body = (await res.json().catch(() => null)) as (Partial<RecoveryInviteResponse> & { error?: string }) | null;
      if (!res.ok) {
        throw new Error(body?.error || "Failed to mint recovery link");
      }
      if (typeof body?.url !== "string") {
        throw new Error("Recovery response did not include a link");
      }
      setMintedUrl(body.url);
      setUserId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mint recovery link");
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={cardStyle}>
      <p style={{ ...hint, marginTop: 0 }}>
        Mint a one-time sign-in link for an existing member: one who has never signed in, or one who cannot reach a signed-in device. A new link replaces their previous outstanding link.
      </p>
      <label style={subLabel}>User</label>
      <select
        value={userId}
        onChange={(e) => {
          setUserId(e.target.value);
          setError(null);
        }}
        style={dialogInput}
      >
        <option value="">Select a user...</option>
        {userOptions.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      {error && <p style={{ fontSize: 11, color: "#ff6b6b", margin: "6px 0 0" }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          onClick={() => {
            void submit();
          }}
          disabled={pending || !userId}
          style={{
            ...dialogSaveBtn,
            opacity: pending || !userId ? 0.5 : 1,
          }}
        >
          {pending ? "Minting..." : "Mint recovery link"}
        </button>
      </div>
      {mintedUrl && <MintedUrlBox url={mintedUrl} />}
    </div>
  );
}
