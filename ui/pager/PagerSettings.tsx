import { useId } from "react";
import { useI18n } from "../i18n.tsx";
import { pagerRequest, pagerFailure, pagerFailureText, type PagerFailure } from "./feedback.ts";
import { useEffect, useState } from "react";
import type { PagerSettingsWire } from "../../shared/types.ts";
import { dialogInput, dialogLabel, dialogSaveBtn } from "../components/modals/dialog-styles.ts";
import { cardStyle, hint, subsectionHeader } from "../components/AccessPaneShared.tsx";

const REPEATS = [5, 15, 30, 60, null] as const;

export function PagerSettings() {
  const { t, language } = useI18n();
  const id = useId();
  const [settings, setSettings] = useState<PagerSettingsWire | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [discordUserId, setDiscordUserId] = useState("");
  const [repeatMinutes, setRepeatMinutes] = useState<number | null>(5);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: PagerFailure } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    pagerRequest<{ settings: PagerSettingsWire }>("/api/pager/settings")
      .then((body) => {
        if (!active) return;
        setSettings(body.settings);
        setDiscordUserId(body.settings.discordUserId);
        setRepeatMinutes(body.settings.repeatMinutes);
      })
      .catch((error) => {
        if (active) setStatus({ kind: "error", text: pagerFailure(error, "pager.settings.loadFailed") });
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(changes: Record<string, unknown>) {
    setPending(true);
    setStatus(null);
    try {
      const body = await pagerRequest<{ settings: PagerSettingsWire }>("/api/pager/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      setSettings(body.settings);
      setWebhookUrl("");
      setStatus({ kind: "ok", text: { key: "common.saved" } });
    } catch (error) {
      setStatus({ kind: "error", text: pagerFailure(error, "pager.settings.saveFailed") });
    } finally {
      setPending(false);
    }
  }

  async function sendTest() {
    setPending(true);
    setStatus(null);
    try {
      await pagerRequest("/api/pager/settings/test", { method: "POST" });
      setStatus({ kind: "ok", text: { key: "pager.settings.testSent" } });
    } catch (error) {
      setStatus({ kind: "error", text: pagerFailure(error, "pager.settings.testRequestFailed") });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h5 style={subsectionHeader}>{t("pager.settings.title")}</h5>
      <p style={hint}>{t("pager.settings.hint")}</p>
      <div style={cardStyle}>
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <label htmlFor={id + "-webhook"} style={dialogLabel}>
            {t("pager.settings.webhook")} ({t(settings?.webhookConfigured ? "pager.settings.configured" : "pager.settings.unset")})
          </label>
          <input
            id={id + "-webhook"}
            type="password"
            autoComplete="off"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            style={dialogInput}
          />
          <label htmlFor={id + "-user"} style={dialogLabel}>
            {t("pager.settings.user")}
          </label>
          <input id={id + "-user"} value={discordUserId} onChange={(e) => setDiscordUserId(e.target.value)} placeholder={t("pager.settings.userExample")} style={dialogInput} />
          <label htmlFor={id + "-repeat"} style={dialogLabel}>
            {t("pager.settings.repeat")}
          </label>
          <select
            id={id + "-repeat"}
            value={repeatMinutes === null ? "once" : String(repeatMinutes)}
            onChange={(e) => setRepeatMinutes(e.target.value === "once" ? null : Number(e.target.value))}
            style={dialogInput}
          >
            {REPEATS.map((repeat) => (
              <option key={repeat ?? "once"} value={repeat === null ? "once" : repeat}>
                {repeat === null ? t("pager.settings.once") : repeat === 60 ? t("pager.settings.hour") : t("pager.settings.minutes", { count: repeat.toLocaleString(language) })}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              disabled={pending}
              onClick={() => void save({ discordUserId, repeatMinutes, ...(webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {}) })}
              style={{ ...dialogSaveBtn, opacity: pending ? 0.5 : 1 }}
            >
              {t("common.save")}
            </button>
            <button disabled={pending || !settings?.webhookConfigured} onClick={() => void sendTest()} style={{ ...dialogSaveBtn, opacity: pending || !settings?.webhookConfigured ? 0.5 : 1 }}>
              {t("pager.settings.sendTest")}
            </button>
            {settings?.webhookConfigured && (
              <button disabled={pending} onClick={() => void save({ webhookUrl: null })} style={{ ...dialogSaveBtn, background: "var(--red, #f85149)" }}>
                {t("pager.settings.remove")}
              </button>
            )}
          </div>
          {status && <p style={{ fontSize: 11, margin: 0, color: status.kind === "error" ? "#ff6b6b" : "var(--text-ghost)" }}>{pagerFailureText(status.text, t)}</p>}
        </div>
      </div>
    </>
  );
}
