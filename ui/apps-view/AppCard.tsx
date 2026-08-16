// One app's row: state, the name (which links to the running app), its blurb,
// the facts a human wants at a glance, the verbs, and the log pane when open.

import type { AppState as AppRunState, AppWire } from "../../shared/apps.ts";
import { appHref, appLinkLabel } from "./appLinks.ts";
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

export function AppCard({
  app,
  isBusy,
  isMobile,
  logOpen,
  logLines,
  logError,
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
  onAct: (verb: AppVerb) => void;
  onToggleLogs: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-subtle)", padding: isMobile ? 12 : 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <StateDot state={app.state} />
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{app.name}</span>
        <span style={{ fontSize: 11, color: STATE_COLOR[app.state], textTransform: "lowercase" }}>{app.state}</span>
        <a
          href={appHref(app, window.location.hostname)}
          target="_blank"
          rel="noreferrer"
          title={appLinkLabel(app)}
          style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--accent)" }}
        >
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
