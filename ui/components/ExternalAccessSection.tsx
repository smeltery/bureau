import { useEffect, useRef, useState } from "react";
import { normalizePublicOrigin } from "../../shared/public-origin.ts";
import { dialogInput, dialogSaveBtn } from "./modals/dialog-styles.ts";
import { addRawListener, removeRawListener, send } from "../ws.ts";
import { cardStyle, codeBlockStyle, hint, MintedUrlBox, restartBoxStyle, subLabel, subsectionHeader } from "./AccessPaneShared.tsx";

// Owner-only "where can people reach this office from?" controls. Pre-claim
// or with external access disabled, bureau binds 127.0.0.1 only. Flipping
// the toggle and saving stores the new state plus the public URL, mints an
// owner self-invite bound to the NEW origin (the running process still has
// the old bind in place, so this URL won't resolve until restart), and
// prompts the operator to restart bureau.
export function ExternalAccessSection() {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [officeNameInput, setOfficeNameInput] = useState("");
  const [envOriginSet, setEnvOriginSet] = useState(false);
  // The normalized env value, or null when the env var is absent OR set but
  // invalid (in which case envOriginSet is true while envOrigin is null —
  // the UI uses that combination to flag the invalid case).
  const [envOrigin, setEnvOrigin] = useState<string | null>(null);
  const [boundLoopback, setBoundLoopback] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInUrl, setSignInUrl] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const pendingListenerRef = useRef<((data: string) => void) | null>(null);

  // Snapshot of the last-saved state. Compared against the form during
  // render to drive the Save-button enabled/disabled state.
  const [savedSnapshot, setSavedSnapshot] = useState<{ enabled: boolean; urlInput: string; officeNameInput: string }>({ enabled: false, urlInput: "", officeNameInput: "" });

  useEffect(() => {
    const fn = (data: string) => {
      try {
        const m = JSON.parse(data);
        if (m.type === "access_settings" && m.ok) {
          const nextEnabled = !!m.externalAccess;
          const nextUrl = typeof m.publicOrigin === "string" ? m.publicOrigin : "";
          const nextOfficeName = typeof m.officeName === "string" ? m.officeName : "";
          setEnabled(nextEnabled);
          setUrlInput(nextUrl);
          setOfficeNameInput(nextOfficeName);
          setEnvOriginSet(!!m.envOriginSet);
          setEnvOrigin(typeof m.envOrigin === "string" ? m.envOrigin : null);
          setBoundLoopback(!!m.boundLoopback);
          setSavedSnapshot({ enabled: nextEnabled, urlInput: nextUrl, officeNameInput: nextOfficeName });
          setLoaded(true);
        }
      } catch {}
    };
    addRawListener(fn);
    send({ type: "get_access_settings" });
    return () => removeRawListener(fn);
  }, []);

  useEffect(() => {
    return () => {
      const fn = pendingListenerRef.current;
      if (fn) removeRawListener(fn);
    };
  }, []);

  function submit() {
    const reqId = `access-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const trimmed = urlInput.trim();
    setPending(true);
    setError(null);
    setSignInUrl(null);
    setRestartRequired(false);
    const listener = (data: string) => {
      try {
        const m = JSON.parse(data);
        if (m.type === "access_settings_updated" && m.requestId === reqId) {
          setPending(false);
          removeRawListener(listener);
          pendingListenerRef.current = null;
          if (m.ok) {
            const nextEnabled = !!m.externalAccess;
            const nextUrl = typeof m.publicOrigin === "string" ? m.publicOrigin : "";
            const nextOfficeName = typeof m.officeName === "string" ? m.officeName : "";
            setEnabled(nextEnabled);
            setUrlInput(nextUrl);
            setOfficeNameInput(nextOfficeName);
            setSavedSnapshot({ enabled: nextEnabled, urlInput: nextUrl, officeNameInput: nextOfficeName });
            setSignInUrl(typeof m.signInUrl === "string" ? m.signInUrl : null);
            setRestartRequired(!!m.restartRequired);
          } else {
            setError(m.error || "Failed to update settings");
          }
        }
      } catch {}
    };
    pendingListenerRef.current = listener;
    addRawListener(listener);
    send({
      type: "update_access_settings",
      requestId: reqId,
      externalAccess: enabled,
      publicOrigin: enabled ? trimmed : null,
      officeName: officeNameInput.trim() || null,
    });
  }

  const dirty = enabled !== savedSnapshot.enabled || urlInput.trim() !== savedSnapshot.urlInput || officeNameInput.trim() !== savedSnapshot.officeNameInput;

  // Apply the same normalization the server uses, so the env-conflict /
  // env-match notes don't flash a false warning when the operator types
  // an equivalent-but-unnormalized URL.
  const normalizedInput = normalizePublicOrigin(urlInput);

  if (!loaded) {
    return (
      <div style={cardStyle}>
        <h5 style={{ ...subsectionHeader, margin: "0 0 6px" }}>External access</h5>
        <p style={hint}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <h5 style={{ ...subsectionHeader, margin: "0 0 6px" }}>External access</h5>
      <p style={hint}>
        Currently {boundLoopback ? "loopback-only" : "listening externally"}.
        {boundLoopback ? " The office is reachable from this machine, or from other machines via an SSH tunnel." : " The office is reachable from anywhere the public URL resolves."}
      </p>
      <div style={subLabel}>Office name (optional)</div>
      <input value={officeNameInput} onChange={(e) => setOfficeNameInput(e.target.value.slice(0, 64))} placeholder="e.g. Acme HQ" style={dialogInput} />
      <p style={hint}>
        Shown on the sign-in and invite pages as "&lt;Office name&gt; | Bureau — sign in". Useful when you run multiple bureau instances and want to tell them apart at a glance. Takes effect
        immediately.
      </p>
      <label style={{ display: "flex", gap: 6, marginTop: 12, fontSize: 12 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Enable external access</span>
      </label>
      {enabled && (
        <>
          <div style={subLabel}>Public URL</div>
          <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://my-mac-mini.tailnet.ts.net" style={dialogInput} />
          <p style={hint}>Pattern: https://&lt;host&gt; (the address you'll open from your laptop / phone). Saving doesn't change the running server's bind on its own — restart bureau to apply.</p>
        </>
      )}
      {envOriginSet && !envOrigin && (
        <p style={{ ...hint, marginTop: 6 }}>
          Note: <code>BUREAU_PUBLIC_ORIGIN</code> is set in the environment but not a valid public origin, so the server ignores it. Remove it from your env file or set it to{" "}
          <code>https://&lt;host&gt;</code> or <code>http://localhost</code>.
        </p>
      )}
      {envOrigin && enabled && normalizedInput === envOrigin && (
        <p style={{ ...hint, marginTop: 6 }}>
          Note: <code>BUREAU_PUBLIC_ORIGIN={envOrigin}</code> is set in the environment and matches this Public URL. The env var is deprecated — remove it from your env file once this office-config
          value is saved.
        </p>
      )}
      {envOrigin && enabled && normalizedInput && normalizedInput !== envOrigin && (
        <p style={{ ...hint, marginTop: 6 }}>
          Note: <code>BUREAU_PUBLIC_ORIGIN={envOrigin}</code> is set in the environment. After restart it would override any different value saved here, so the save will be refused until you either
          match this URL to the env value or remove the env var from your service environment.
        </p>
      )}
      {envOrigin && !enabled && (
        <p style={{ ...hint, marginTop: 6 }}>
          Note: <code>BUREAU_PUBLIC_ORIGIN={envOrigin}</code> is set in the environment but the office is bound loopback-only, so the value is ignored at runtime. The env var is deprecated — remove it
          from your env file.
        </p>
      )}
      {error && <p style={{ fontSize: 11, color: "#ff6b6b", margin: "6px 0 0" }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={submit} disabled={pending || !dirty} style={{ ...dialogSaveBtn, opacity: pending || !dirty ? 0.5 : 1 }}>
          {pending ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </div>
      {restartRequired && (
        <div style={restartBoxStyle}>
          <p style={{ ...hint, marginTop: 0 }}>Saved. Restart bureau so the new bind takes effect:</p>
          <code style={codeBlockStyle}>systemctl --user restart bureau</code>
          {signInUrl && (
            <>
              <p style={{ ...hint, marginTop: 10 }}>After the restart, open this URL on whichever device you want to use from the public address. (It expires 1 hour after minting.)</p>
              <MintedUrlBox url={signInUrl} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
