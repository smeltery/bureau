import { useId } from "react";
import { useI18n } from "../i18n.tsx";
import { accessFailureText, type AccessFailure } from "./access/feedback.ts";
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
type AccessSnapshot = { enabled: boolean; urlInput: string; officeNameInput: string; previewAllowHostsInput: string };

export function hasExternalAccessChanges(enabled: boolean, urlInput: string, officeNameInput: string, previewAllowHostsInput: string, savedSnapshot: AccessSnapshot): boolean {
  return (
    enabled !== savedSnapshot.enabled ||
    urlInput.trim() !== savedSnapshot.urlInput ||
    officeNameInput.trim() !== savedSnapshot.officeNameInput ||
    previewAllowHostsInput.trim() !== savedSnapshot.previewAllowHostsInput
  );
}

export function shouldBlockExternalAccessUnload(loaded: boolean, dirty: boolean): boolean {
  return loaded && dirty;
}

export function ExternalAccessSection({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { t, rich } = useI18n();
  const id = useId();
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [officeNameInput, setOfficeNameInput] = useState("");
  const [previewAllowHostsInput, setPreviewAllowHostsInput] = useState("");
  const [envOriginSet, setEnvOriginSet] = useState(false);
  // The normalized env value, or null when the env var is absent OR set but
  // invalid (in which case envOriginSet is true while envOrigin is null —
  // the UI uses that combination to flag the invalid case).
  const [envOrigin, setEnvOrigin] = useState<string | null>(null);
  const [boundLoopback, setBoundLoopback] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AccessFailure | null>(null);
  const [signInUrl, setSignInUrl] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const pendingListenerRef = useRef<((data: string) => void) | null>(null);

  // Snapshot of the last-saved state. Compared against the form during
  // render to drive the Save-button enabled/disabled state.
  const [savedSnapshot, setSavedSnapshot] = useState<AccessSnapshot>({ enabled: false, urlInput: "", officeNameInput: "", previewAllowHostsInput: "" });

  useEffect(() => {
    const fn = (data: string) => {
      try {
        const m = JSON.parse(data);
        if (m.type === "access_settings" && m.ok) {
          const nextEnabled = !!m.externalAccess;
          const nextUrl = typeof m.publicOrigin === "string" ? m.publicOrigin : "";
          const nextOfficeName = typeof m.officeName === "string" ? m.officeName : "";
          const nextPreviewHosts = Array.isArray(m.previewAllowHosts) ? m.previewAllowHosts.filter((v: unknown): v is string => typeof v === "string").join("\n") : "";
          setEnabled(nextEnabled);
          setUrlInput(nextUrl);
          setOfficeNameInput(nextOfficeName);
          setPreviewAllowHostsInput(nextPreviewHosts);
          setEnvOriginSet(!!m.envOriginSet);
          setEnvOrigin(typeof m.envOrigin === "string" ? m.envOrigin : null);
          setBoundLoopback(!!m.boundLoopback);
          setSavedSnapshot({ enabled: nextEnabled, urlInput: nextUrl, officeNameInput: nextOfficeName, previewAllowHostsInput: nextPreviewHosts });
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
            const nextPreviewHosts = Array.isArray(m.previewAllowHosts) ? m.previewAllowHosts.filter((v: unknown): v is string => typeof v === "string").join("\n") : previewAllowHostsInput.trim();
            setEnabled(nextEnabled);
            setUrlInput(nextUrl);
            setOfficeNameInput(nextOfficeName);
            setPreviewAllowHostsInput(nextPreviewHosts);
            setSavedSnapshot({ enabled: nextEnabled, urlInput: nextUrl, officeNameInput: nextOfficeName, previewAllowHostsInput: nextPreviewHosts });
            setSignInUrl(typeof m.signInUrl === "string" ? m.signInUrl : null);
            setRestartRequired(!!m.restartRequired);
          } else {
            setError(m.error || { key: "externalUi.failed" });
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
      previewAllowHosts: parsePreviewAllowHostsInput(previewAllowHostsInput),
    });
  }

  const dirty = hasExternalAccessChanges(enabled, urlInput, officeNameInput, previewAllowHostsInput, savedSnapshot);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!shouldBlockExternalAccessUnload(loaded, dirty)) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, loaded]);

  // Apply the same normalization the server uses, so the env-conflict /
  // env-match notes don't flash a false warning when the operator types
  // an equivalent-but-unnormalized URL.
  const normalizedInput = normalizePublicOrigin(urlInput);

  if (!loaded) {
    return (
      <div style={cardStyle}>
        <h5 style={{ ...subsectionHeader, margin: "0 0 6px" }}>{t("externalUi.title")}</h5>
        <p style={hint}>{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <h5 style={{ ...subsectionHeader, margin: "0 0 6px" }}>{t("externalUi.title")}</h5>
      <p style={hint}>{t(boundLoopback ? "externalUi.loopback" : "externalUi.external")}</p>
      <label htmlFor={id + "-name"} style={subLabel}>
        {t("externalUi.name")}
      </label>
      <input id={id + "-name"} value={officeNameInput} onChange={(e) => setOfficeNameInput(e.target.value.slice(0, 64))} placeholder={t("externalUi.nameExample")} style={dialogInput} />
      <p style={hint}>{t("externalUi.nameHint")}</p>
      <label style={{ display: "flex", gap: 6, marginTop: 12, fontSize: 12 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>{t("externalUi.enable")}</span>
      </label>
      {enabled && (
        <>
          <label htmlFor={id + "-url"} style={subLabel}>
            {t("externalUi.url")}
          </label>
          <input id={id + "-url"} value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://my-mac-mini.tailnet.ts.net" style={dialogInput} />
          <p style={hint}>{rich("externalUi.urlHint", { pattern: <code>{"https://<host>"}</code> })}</p>
        </>
      )}
      <label htmlFor={id + "-hosts"} style={subLabel}>
        {t("externalUi.hosts")}
      </label>
      <textarea
        id={id + "-hosts"}
        value={previewAllowHostsInput}
        onChange={(e) => setPreviewAllowHostsInput(e.target.value)}
        placeholder={"example.com\nstaging.example.com"}
        rows={3}
        style={{ ...dialogInput, resize: "vertical", minHeight: 72 }}
      />
      <p style={hint}>{t("externalUi.hostsHint")}</p>
      {envOriginSet && !envOrigin && (
        <p style={{ ...hint, marginTop: 6 }}>
          {rich("externalUi.envInvalid", { variable: <code>BUREAU_PUBLIC_ORIGIN</code>, https: <code>{"https://<host>"}</code>, local: <code>http://localhost</code> })}
        </p>
      )}
      {envOrigin && enabled && normalizedInput === envOrigin && <p style={{ ...hint, marginTop: 6 }}>{rich("externalUi.envMatch", { assignment: <code>BUREAU_PUBLIC_ORIGIN={envOrigin}</code> })}</p>}
      {envOrigin && enabled && normalizedInput && normalizedInput !== envOrigin && (
        <p style={{ ...hint, marginTop: 6 }}>{rich("externalUi.envConflict", { assignment: <code>BUREAU_PUBLIC_ORIGIN={envOrigin}</code> })}</p>
      )}
      {envOrigin && !enabled && <p style={{ ...hint, marginTop: 6 }}>{rich("externalUi.envIgnored", { assignment: <code>BUREAU_PUBLIC_ORIGIN={envOrigin}</code> })}</p>}
      {error && <p style={{ fontSize: 11, color: "#ff6b6b", margin: "6px 0 0" }}>{accessFailureText(error, t)}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={submit} disabled={pending || !dirty} style={{ ...dialogSaveBtn, opacity: pending || !dirty ? 0.5 : 1 }}>
          {t(pending ? "externalUi.saving" : dirty ? "common.save" : "common.saved")}
        </button>
      </div>
      {restartRequired && (
        <div style={restartBoxStyle}>
          <p style={{ ...hint, marginTop: 0 }}>{t("externalUi.restart")}</p>
          <code style={codeBlockStyle}>systemctl --user restart bureau</code>
          <p style={{ ...hint, marginTop: 8 }}>{t("externalUi.systemService")}</p>
          <code style={codeBlockStyle}>sudo systemctl restart bureau</code>
          {signInUrl && (
            <>
              <p style={{ ...hint, marginTop: 10 }}>{t("externalUi.signIn")}</p>
              <MintedUrlBox url={signInUrl} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function parsePreviewAllowHostsInput(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((part) => part.trim())
    .filter(Boolean);
}
