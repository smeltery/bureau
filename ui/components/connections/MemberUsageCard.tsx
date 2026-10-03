import { useEffect, useState } from "react";
import type { OfficeSettings } from "../../../shared/types.ts";
import type { OfficeUsageStatusWire } from "../../../shared/user-types.ts";
import { DEFAULT_MEMBER_SHARE, MEMBER_SHARE_OPTIONS } from "../../../shared/member-usage/share.ts";
import { dialogCancelBtn, dialogHint, dialogInput, dialogSaveBtn } from "../modals/dialog-styles.ts";
import { useI18n } from "../../i18n.tsx";

type OfficeSettingsRes = OfficeSettings & { version: string };

class ApiError extends Error {
  status: number;
  code?: string;
  detail?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, detail?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function MemberUsageCard() {
  const { t, language } = useI18n();
  const [settings, setSettings] = useState<OfficeSettingsRes | null>(null);
  const [usageCap, setUsageCap] = useState(false);
  const [usageShare, setUsageShare] = useState(DEFAULT_MEMBER_SHARE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function adopt(next: OfficeSettingsRes) {
    setSettings(next);
    setUsageCap(next.memberUsageCap ?? false);
    setUsageShare(next.memberUsageShare ?? DEFAULT_MEMBER_SHARE);
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch<OfficeSettingsRes>("GET", "/api/office/settings")
      .then((result) => {
        if (!cancelled) adopt(result);
      })
      .catch(() => {
        // Older or unavailable servers do not give us a version-safe write.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!settings || settings.memberUsageCap === undefined) return null;

  const baselineCap = settings.memberUsageCap ?? false;
  const baselineShare = settings.memberUsageShare ?? DEFAULT_MEMBER_SHARE;
  const shareKnown = settings.memberUsageShare !== undefined;
  const dirty = usageCap !== baselineCap || usageShare !== baselineShare;

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await apiFetch<void>("PUT", "/api/office/settings", {
        prompt: settings.prompt ?? null,
        envFile: settings.envFile ?? null,
        experimental: settings.experimental,
        receptionistAgentId: settings.receptionistAgentId,
        version: settings.version,
        memberUsageCap: usageCap,
        ...(shareKnown ? { memberUsageShare: usageShare } : {}),
      });
      adopt(await apiFetch<OfficeSettingsRes>("GET", "/api/office/settings"));
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("common.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ marginTop: 14, padding: "12px 0 0", borderTop: "1px solid var(--border-subtle)" }}>
      <label style={{ display: "flex", gap: 6, fontSize: 12, fontWeight: 650, color: "var(--text-primary)" }}>
        <input
          type="checkbox"
          checked={usageCap}
          disabled={saving}
          onChange={(event) => {
            setSaved(false);
            setUsageCap(event.target.checked);
          }}
        />
        <span>{t("memberUsage.cap")}</span>
      </label>
      <p style={{ ...dialogHint, margin: "3px 0 0" }}>{t("memberUsage.capHint")}</p>

      {usageCap && shareKnown && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
          <span>{t("memberUsage.share")}</span>
          <select
            value={usageShare}
            disabled={saving}
            onChange={(event) => {
              setSaved(false);
              setUsageShare(Number(event.target.value));
            }}
            style={{ ...dialogInput, width: "auto", padding: "2px 6px", cursor: "pointer" }}
          >
            {MEMBER_SHARE_OPTIONS.map((share) => (
              <option key={share} value={share}>
                {formatNumber(language, share)}%
              </option>
            ))}
          </select>
        </label>
      )}

      {baselineCap &&
        (settings.memberUsageStatus ?? []).map((row) => (
          <p key={row.provider} style={{ fontSize: 10, color: row.state === "failed" ? "var(--red)" : "var(--text-muted)", margin: "3px 0 0" }}>
            {usageStatusLine(row, t, language)}
          </p>
        ))}

      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 12, marginTop: 8 }}>
          {error}
        </p>
      )}
      {saved && !dirty && <p style={{ ...dialogHint, marginTop: 8 }}>{t("common.saved")}</p>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          style={dialogCancelBtn}
          disabled={saving || !dirty}
          onClick={() => {
            setUsageCap(baselineCap);
            setUsageShare(baselineShare);
            setSaved(false);
            setError(null);
          }}
        >
          {t("common.cancel")}
        </button>
        <button type="button" style={dialogSaveBtn} disabled={saving || !dirty} onClick={() => void save()}>
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </section>
  );
}

function usageStatusLine(row: OfficeUsageStatusWire, t: ReturnType<typeof useI18n>["t"], language: ReturnType<typeof useI18n>["language"]): string {
  const provider = row.provider === "claude" ? "Claude" : "Codex";
  if (row.state !== "weekly") return t("memberUsage.unavailable", { provider });
  return t("memberUsage.weekly", {
    provider,
    used: formatNumber(language, Math.round(row.usedPercent)),
    line: formatNumber(language, Math.round(row.linePercent * 10) / 10),
  });
}

function formatNumber(language: string, value: number): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
}

async function apiFetch<T>(method: "GET" | "PUT", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      parsed?.error || `Request failed (${res.status})`,
      typeof parsed?.code === "string" ? parsed.code : undefined,
      parsed?.detail && typeof parsed.detail === "object" ? parsed.detail : undefined,
    );
  }
  return (await res.json().catch(() => undefined)) as T;
}
