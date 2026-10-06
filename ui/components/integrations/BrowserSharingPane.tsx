import { useEffect, useState } from "react";
import type { SharedTabGrant } from "../../../shared/integrations/browser-sharing.ts";
import { dialogCancelBtn, dialogHint } from "../modals/dialog-styles.ts";
interface Device {
  id: string;
  name: string;
  expiresAt: number;
}
async function request(path: string, method = "GET") {
  const response = await fetch(`/api/browser-sharing/${path}`, { method, credentials: "same-origin" });
  if (!response.ok) throw new Error((await response.json()).error ?? "Request failed");
  return response.status === 204 ? null : response.json();
}
export function BrowserSharingPane() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [grants, setGrants] = useState<SharedTabGrant[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const [nextDevices, nextGrants] = await Promise.all([request("devices"), request("grants")]);
    setDevices(nextDevices);
    setGrants(nextGrants);
  }
  useEffect(() => {
    void refresh().catch((caught) => setError(caught.message));
  }, []);
  async function perform(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section style={{ marginTop: 24 }}>
      <h4>Share browser tabs with agents</h4>
      <p style={dialogHint}>
        Install the Chrome extension, pair it with this office, then explicitly offer a tab to selected agents you manage. Shared tabs use your signed-in browser session. You can stop sharing here or
        in the extension.
      </p>
      <p>
        <a href="/bureau-browser.zip" download>
          Download Chrome extension
        </a>{" "}
        ·{" "}
        <a href="https://github.com/smeltery/bureau/blob/master/docs/features/browser-sharing.md" target="_blank" rel="noreferrer">
          Setup instructions
        </a>
      </p>
      <p style={dialogHint}>
        Extract the ZIP into a permanent folder. In chrome://extensions, enable Developer mode and choose Load unpacked. Select the extracted folder, then pair from the extension popup.
      </p>
      <button
        style={dialogCancelBtn}
        disabled={busy}
        onClick={() =>
          void perform(async () => {
            setCode((await request("pairing", "POST")).code);
          })
        }
      >
        Create pairing code
      </button>{" "}
      <button style={dialogCancelBtn} disabled={busy} onClick={() => void perform(refresh)}>
        Refresh
      </button>
      {code && (
        <div>
          <p style={dialogHint}>Paste into the extension with this office URL: {location.origin}. This single-use code expires after five minutes.</p>
          <input aria-label="Pairing code" type="password" readOnly value={code} />
          <button onClick={() => void perform(() => navigator.clipboard.writeText(code))}>Copy code</button>
          <button onClick={() => setCode("")}>Dismiss</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {devices.map((device) => (
        <p key={device.id}>
          {device.name} · paired until {new Date(device.expiresAt).toLocaleDateString()}{" "}
          <button disabled={busy} onClick={() => void perform(() => request(`devices/${device.id}`, "DELETE"))}>
            Unpair
          </button>
        </p>
      ))}
      {grants.map((grant) => (
        <p key={grant.id}>
          {grant.title} · {grant.origin} · {grant.expiresAt ? `until ${new Date(grant.expiresAt).toLocaleTimeString()}` : "until revoked"}{" "}
          <button disabled={busy} onClick={() => void perform(() => request(`grants/${grant.id}`, "DELETE"))}>
            Stop sharing
          </button>
        </p>
      ))}
    </section>
  );
}
