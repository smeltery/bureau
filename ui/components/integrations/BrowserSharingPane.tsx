import { useEffect, useState } from "react";
import { useI18n } from "../../i18n.tsx";
import type { SharedTabGrant } from "../../../shared/integrations/browser-sharing.ts";
import { dialogCancelBtn, dialogHint } from "../modals/dialog-styles.ts";
interface Device {
  id: string;
  name: string;
  expiresAt: number;
}
class SharingRequestError extends Error {
  constructor() {
    super("Request failed");
  }
}
type SharingFailure = string | { key: "browserSharing.failed" };
function sharingFailure(error: unknown): SharingFailure {
  return error instanceof SharingRequestError || !(error instanceof Error) ? { key: "browserSharing.failed" } : error.message;
}
async function request(path: string, method = "GET") {
  const response = await fetch(`/api/browser-sharing/${path}`, { method, credentials: "same-origin" });
  if (!response.ok) {
    const error = (await response.json()).error;
    throw error == null ? new SharingRequestError() : new Error(error);
  }
  return response.status === 204 ? null : response.json();
}
export function BrowserSharingPane() {
  const { t, language } = useI18n();
  const [devices, setDevices] = useState<Device[]>([]);
  const [grants, setGrants] = useState<SharedTabGrant[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<SharingFailure | null>(null);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const [nextDevices, nextGrants] = await Promise.all([request("devices"), request("grants")]);
    setDevices(nextDevices);
    setGrants(nextGrants);
  }
  useEffect(() => {
    void refresh().catch((caught) => setError(sharingFailure(caught)));
  }, []);
  async function perform(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await refresh();
    } catch (caught) {
      setError(sharingFailure(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section style={{ marginTop: 24 }}>
      <h4>{t("browserSharing.title")}</h4>
      <p style={dialogHint}>{t("browserSharing.hint")}</p>
      <p>
        <a href="/bureau-browser.zip" download>
          {t("browserSharing.download")}
        </a>{" "}
        ·{" "}
        <a href="https://github.com/smeltery/bureau/blob/master/docs/features/browser-sharing.md" target="_blank" rel="noreferrer">
          {t("browserSharing.instructions")}
        </a>
      </p>
      <p style={dialogHint}>{t("browserSharing.install", { extensions: "chrome://extensions" })}</p>
      <button
        style={dialogCancelBtn}
        disabled={busy}
        onClick={() =>
          void perform(async () => {
            setCode((await request("pairing", "POST")).code);
          })
        }
      >
        {t("browserSharing.create")}
      </button>{" "}
      <button style={dialogCancelBtn} disabled={busy} onClick={() => void perform(refresh)}>
        {t("common.refresh")}
      </button>
      {code && (
        <div>
          <p style={dialogHint}>{t("browserSharing.pairHint", { origin: location.origin })}</p>
          <input aria-label={t("browserSharing.code")} type="password" readOnly value={code} />
          <button onClick={() => void perform(() => navigator.clipboard.writeText(code))}>{t("browserSharing.copy")}</button>
          <button onClick={() => setCode("")}>{t("browserSharing.dismiss")}</button>
        </div>
      )}
      {error && <p role="alert">{typeof error === "string" ? error : t(error.key)}</p>}
      {devices.map((device) => (
        <p key={device.id}>
          {t("browserSharing.paired", { name: device.name, date: new Date(device.expiresAt).toLocaleDateString(language) })}{" "}
          <button disabled={busy} onClick={() => void perform(() => request(`devices/${device.id}`, "DELETE"))}>
            {t("browserSharing.unpair")}
          </button>
        </p>
      ))}
      {grants.map((grant) => (
        <p key={grant.id}>
          {grant.title} · {grant.origin} · {grant.expiresAt ? t("browserSharing.until", { time: new Date(grant.expiresAt).toLocaleTimeString(language) }) : t("browserSharing.revoked")}{" "}
          <button disabled={busy} onClick={() => void perform(() => request(`grants/${grant.id}`, "DELETE"))}>
            {t("browserSharing.stop")}
          </button>
        </p>
      ))}
    </section>
  );
}
