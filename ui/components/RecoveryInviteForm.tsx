import { useId } from "react";
import { useI18n } from "../i18n.tsx";
import { accessFailureText, type AccessFailure } from "./access/feedback.ts";
import type { SupportedLanguageCode } from "../../shared/languages.ts";
import { useMemo, useState } from "react";
import type { InviteWire, UserRecord } from "../../shared/types.ts";
import { useAppState } from "../store.tsx";
import { dialogInput, dialogSaveBtn } from "./modals/dialog-styles.ts";
import { cardStyle, hint, MintedUrlBox, subLabel } from "./AccessPaneShared.tsx";

type RecoveryInviteResponse = {
  url: string;
  invite: InviteWire;
};

export function recoveryInviteUserOptions(users: Map<string, UserRecord>, language?: SupportedLanguageCode): UserRecord[] {
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name, language));
}

export function RecoveryInviteForm() {
  const { t, language } = useI18n();
  const userIdLabel = useId();
  const { users } = useAppState();
  const [userId, setUserId] = useState("");
  const [mintedUrl, setMintedUrl] = useState<string | null>(null);
  const [error, setError] = useState<AccessFailure | null>(null);
  const [pending, setPending] = useState(false);
  const userOptions = useMemo(() => recoveryInviteUserOptions(users, language), [users, language]);

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
        setError(body?.error || { key: "invitesUi.recoveryFailed" });
        return;
      }
      if (typeof body?.url !== "string") {
        setError({ key: "invitesUi.missingLink" });
        return;
      }
      setMintedUrl(body.url);
      setUserId("");
    } catch {
      setError({ key: "invitesUi.recoveryFailed" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={cardStyle}>
      <p style={{ ...hint, marginTop: 0 }}>{t("invitesUi.recoveryHint")}</p>
      <label htmlFor={userIdLabel} style={subLabel}>
        {t("accessUi.user")}
      </label>
      <select
        id={userIdLabel}
        value={userId}
        onChange={(e) => {
          setUserId(e.target.value);
          setError(null);
        }}
        style={dialogInput}
      >
        <option value="">{t("invitesUi.selectUser")}</option>
        {userOptions.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      {error && <p style={{ fontSize: 11, color: "#ff6b6b", margin: "6px 0 0" }}>{accessFailureText(error, t)}</p>}
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
          {t(pending ? "invitesUi.minting" : "invitesUi.mintRecovery")}
        </button>
      </div>
      {mintedUrl && <MintedUrlBox url={mintedUrl} />}
    </div>
  );
}
