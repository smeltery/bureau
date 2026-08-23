// One app's row: state, the name (which links to the running app), its blurb,
// the facts a human wants at a glance, the verbs, and the log pane when open.

import { useEffect, useRef, useState } from "react";
import type { AppState as AppRunState, AppWire } from "../../shared/apps.ts";
import { APP_PREVIEW_OPEN_TTL_MS, getAppPreviewOpenedAt, markAppPreviewOpened } from "../device-settings.ts";
import { appHref, appLinkLabel } from "./appLinks.ts";
import { appCanPreview, appPreviewPhase, BACKGROUND_OPEN_FALLBACK_MS } from "./appPreview.ts";
import { APP_VERBS, STATE_COLOR, VERB_TITLES, stateIsHollow, verbInert, type AppVerb } from "./appVerbs.ts";
import { appBtnStyle, appMonoPane } from "./styles.ts";

// A drawn dot, not a glyph: iOS Safari emoji-renders characters like ● and ▶
// and then ignores the CSS color, which would make `failed` and `running` look
// identical on a phone.
function StateDot({ state }: { state: AppRunState }) {
  const hollow = stateIsHollow(state);
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        flexShrink: 0,
        background: hollow ? "transparent" : STATE_COLOR[state],
        border: hollow ? "1.5px solid var(--text-muted)" : "none",
      }}
    />
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ color: "var(--text-dim, var(--text-muted))" }}>{label} </span>
      <span style={{ color: "var(--text-secondary)" }}>{value}</span>
    </span>
  );
}

function AppPreview({ app, href, isMobile, framesAllowed }: { app: Pick<AppWire, "name">; href: string; isMobile: boolean; framesAllowed: boolean }) {
  const hostRef = useRef<HTMLAnchorElement>(null);
  const [visible, setVisible] = useState(() => !("IntersectionObserver" in window));
  const [openedAt, setOpenedAt] = useState(() => getAppPreviewOpenedAt(href));
  const [now, setNow] = useState(Date.now);
  const [waitingForReturn, setWaitingForReturn] = useState(false);
  const phase = appPreviewPhase(openedAt, now, visible, waitingForReturn, framesAllowed);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "120px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!waitingForReturn) return;
    const returned = () => {
      setNow(Date.now());
      setWaitingForReturn(false);
    };
    const fallback = setTimeout(returned, BACKGROUND_OPEN_FALLBACK_MS);
    window.addEventListener("focus", returned);
    return () => {
      clearTimeout(fallback);
      window.removeEventListener("focus", returned);
    };
  }, [waitingForReturn]);

  useEffect(() => {
    setOpenedAt(getAppPreviewOpenedAt(href));
  }, [href]);

  useEffect(() => {
    if (openedAt === null) return;
    const remaining = openedAt + APP_PREVIEW_OPEN_TTL_MS - Date.now();
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [openedAt]);

  const recordOpen = () => {
    const opened = Date.now();
    markAppPreviewOpened(href, opened);
    setOpenedAt(opened);
    setNow(opened);
    setWaitingForReturn(true);
  };

  return (
    <a
      ref={hostRef}
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`Open ${app.name}`}
      tabIndex={-1}
      onClick={recordOpen}
      onAuxClick={(event) => {
        if (event.button === 1) recordOpen();
      }}
      style={{
        position: "relative",
        display: "block",
        height: isMobile ? 150 : 210,
        marginTop: 10,
        overflow: "hidden",
        border: "1px solid var(--border-subtle)",
        borderRadius: 6,
        background: "var(--bg-code, var(--bg-base))",
        color: "var(--text-muted)",
        textDecoration: "none",
      }}
    >
      {phase === "open-prompt" ? (
        <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 12 }}>Open app to enable preview</span>
      ) : phase === "loading" ? (
        <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 12 }}>Loading preview...</span>
      ) : (
        <iframe src={href} title={`${app.name} preview`} sandbox="allow-scripts" tabIndex={-1} style={{ display: "block", width: "100%", height: "100%", border: 0, pointerEvents: "none" }} />
      )}
      {phase !== "open-prompt" && (
        <span
          style={{
            position: "absolute",
            right: 6,
            bottom: 6,
            padding: "2px 6px",
            borderRadius: 4,
            background: "var(--bg-overlay)",
            color: "var(--text-secondary)",
            fontSize: 10,
            boxShadow: "0 1px 4px var(--shadow-heavy)",
          }}
        >
          live preview
        </span>
      )}
    </a>
  );
}

export function AppCard({
  app,
  isBusy,
  isMobile,
  logOpen,
  logLines,
  logError,
  previewsEnabled,
  livePreviewFramesAllowed,
  onAct,
  onToggleLogs,
  onDelete,
}: {
  app: AppWire;
  isBusy: boolean;
  isMobile: boolean;
  logOpen: boolean;
  logLines: string[] | null;
  logError: string | null;
  previewsEnabled: boolean;
  livePreviewFramesAllowed: boolean;
  onAct: (verb: AppVerb) => void;
  onToggleLogs: () => void;
  onDelete: () => void;
}) {
  const href = appHref(app, window.location.hostname);
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-subtle)", padding: isMobile ? 12 : 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <StateDot state={app.state} />
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{app.name}</span>
        <span style={{ fontSize: 11, color: STATE_COLOR[app.state], textTransform: "lowercase" }}>{app.state}</span>
        <a href={href} target="_blank" rel="noreferrer" title={appLinkLabel(app)} style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>
          {appLinkLabel(app)} ↗
        </a>
      </div>

      {app.description && <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-secondary)" }}>{app.description}</div>}

      <div style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11 }}>
        <Meta label="port" value={String(app.port)} />
        <Meta label="restarts" value={String(app.restartCount)} />
        <Meta label="created by" value={app.createdBy} />
        {app.username && <Meta label="owner" value={app.username} />}
      </div>

      <div style={{ ...appMonoPane, marginTop: 6, padding: 0, background: "transparent", color: "var(--text-muted)" }}>
        {app.command}
        <span style={{ opacity: 0.7 }}> in {app.cwd}</span>
      </div>

      {/* Presence only. startError is in-memory on the server, so its absence
          proves nothing and this never renders an all-clear — `state` is the
          durable signal. */}
      {app.startError && <div style={{ ...appMonoPane, marginTop: 8, color: "var(--red)" }}>{app.startError}</div>}

      {previewsEnabled && appCanPreview(app) && <AppPreview app={app} href={href} isMobile={isMobile} framesAllowed={livePreviewFramesAllowed} />}

      <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {APP_VERBS.map((verb) => {
          const inert = isBusy || verbInert(verb, app.state);
          return (
            <button key={verb} title={VERB_TITLES[verb]} disabled={inert} onClick={() => onAct(verb)} style={appBtnStyle(false, inert)}>
              {verb}
            </button>
          );
        })}
        <button title="Show the app's recent output" disabled={isBusy} onClick={onToggleLogs} style={appBtnStyle(false, isBusy)}>
          {logOpen ? "hide log" : "log"}
        </button>
        <button title="Remove the app" disabled={isBusy} onClick={onDelete} style={appBtnStyle(true, isBusy)}>
          delete
        </button>
      </div>

      {logOpen && (
        <pre
          style={{
            ...appMonoPane,
            marginTop: 10,
            marginBottom: 0,
            padding: 10,
            border: "1px solid var(--border-subtle)",
            color: "var(--text-secondary)",
            maxHeight: 260,
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {logError ?? (logLines === null ? "Loading…" : logLines.length === 0 ? "Nothing in the log yet." : logLines.join("\n"))}
        </pre>
      )}
    </div>
  );
}
