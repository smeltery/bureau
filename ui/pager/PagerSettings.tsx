import { useEffect, useState } from "react";
import type { PagerSettingsWire } from "../../shared/types.ts";
import { dialogInput, dialogLabel, dialogSaveBtn } from "../components/modals/dialog-styles.ts";
import { cardStyle, hint, subsectionHeader } from "../components/AccessPaneShared.tsx";

const REPEATS = [
  { label: "Every 5 minutes", value: 5 },
  { label: "Every 15 minutes", value: 15 },
  { label: "Every 30 minutes", value: 30 },
  { label: "Every hour", value: 60 },
  { label: "Send once", value: null },
] as const;

export function PagerSettings() {
  const [settings, setSettings] = useState<PagerSettingsWire | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [discordUserId, setDiscordUserId] = useState("");
  const [repeatMinutes, setRepeatMinutes] = useState<number | null>(5);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetch("/api/pager/settings")
      .then((res) => res.json())
      .then((body) => {
        if (!body.settings) return;
        setSettings(body.settings);
        setDiscordUserId(body.settings.discordUserId);
        setRepeatMinutes(body.settings.repeatMinutes);
      })
      .catch(() => setStatus({ kind: "error", text: "Could not load pager settings" }));
  }, []);

  async function save(changes: Record<string, unknown>) {
    setPending(true);
    setStatus(null);
    const res = await fetch("/api/pager/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) return setStatus({ kind: "error", text: body.error || "Could not save" });
    setSettings(body.settings);
    setWebhookUrl("");
    setStatus({ kind: "ok", text: "Saved" });
  }

  async function sendTest() {
    setPending(true);
    setStatus(null);
    const res = await fetch("/api/pager/settings/test", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    setStatus(res.ok ? { kind: "ok", text: "Test page sent" } : { kind: "error", text: `Test page failed (${body.failure ?? res.status})` });
  }

  return (
    <>
      <h5 style={subsectionHeader}>Discord delivery</h5>
      <p style={hint}>
        Pages go to a Discord channel through an incoming webhook (channel settings → Integrations → Webhooks) and repeat until you ack or resolve them. Add your Discord user id so the message pings
        your phone.
      </p>
      <div style={cardStyle}>
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <label style={dialogLabel}>Webhook URL {settings?.webhookConfigured ? "(set; paste a new one to replace it)" : "(not set)"}</label>
          <input type="password" autoComplete="off" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/..." style={dialogInput} />
          <label style={dialogLabel}>Discord user id to mention</label>
          <input value={discordUserId} onChange={(e) => setDiscordUserId(e.target.value)} placeholder="e.g. 80351110224678912" style={dialogInput} />
          <label style={dialogLabel}>Repeat while open</label>
          <select value={repeatMinutes === null ? "once" : String(repeatMinutes)} onChange={(e) => setRepeatMinutes(e.target.value === "once" ? null : Number(e.target.value))} style={dialogInput}>
            {REPEATS.map((repeat) => (
              <option key={repeat.label} value={repeat.value === null ? "once" : repeat.value}>
                {repeat.label}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              disabled={pending}
              onClick={() => void save({ discordUserId, repeatMinutes, ...(webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {}) })}
              style={{ ...dialogSaveBtn, opacity: pending ? 0.5 : 1 }}
            >
              Save
            </button>
            <button disabled={pending || !settings?.webhookConfigured} onClick={() => void sendTest()} style={{ ...dialogSaveBtn, opacity: pending || !settings?.webhookConfigured ? 0.5 : 1 }}>
              Send test page
            </button>
            {settings?.webhookConfigured && (
              <button disabled={pending} onClick={() => void save({ webhookUrl: null })} style={{ ...dialogSaveBtn, background: "var(--red, #f85149)" }}>
                Remove webhook
              </button>
            )}
          </div>
          {status && <p style={{ fontSize: 11, margin: 0, color: status.kind === "error" ? "#ff6b6b" : "var(--text-ghost)" }}>{status.text}</p>}
        </div>
      </div>
    </>
  );
}
