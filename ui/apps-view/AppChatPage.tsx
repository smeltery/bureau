/* eslint-disable react/iframe-missing-sandbox -- The server supplies a separate app origin; both flags support app scripts/storage without access to the office DOM. */
import { useEffect, useRef, useState } from "react";
import type { AppChatBoot, AppChatStatus } from "../../shared/integrations/app-chat.ts";
import { useAppState, useDispatch } from "../store.tsx";
import { send } from "../ws.ts";
import { LogView } from "../log-view/LogView.tsx";
import { EditAgentDialog } from "../components/modals/EditAgentDialog.tsx";
import { OPEN_ACCOUNT_SECTION_EVENT } from "../components/account-navigation.ts";
import { ConnectionBanner } from "../components/ConnectionBanner.tsx";
import { CSS } from "../styles.ts";
import { getDevice } from "../device-settings.ts";
import { appChatDraftKey, appSignInUrl, beginAppSignIn, isAppSessionSignal } from "./chat-state.ts";

export function AppChatPage({ boot }: { boot: AppChatBoot }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const [status, setStatus] = useState<AppChatStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const restored = useRef<string | null>(null);
  const skipDraftSave = useRef(false);
  const agent = status?.agentId ? state.agents.find((row) => row.id === status.agentId) : undefined;
  const user = state.sessionContext;
  const draft = agent ? (state.drafts.get(agent.id) ?? "") : "";
  const draftKey = agent && user ? appChatDraftKey(boot, user.userId, agent.id) : null;

  useEffect(() => {
    document.title = `${boot.name} · Bureau`;
    let cancelled = false;
    let controller: AbortController | null = null;
    async function refresh() {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const response = await fetch(`/api/apps/${encodeURIComponent(boot.name)}/chat-view?generation=${boot.hostGen}`, { signal: requestController.signal, cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 404 ? "This app is no longer available." : "Unable to verify app access. Refresh to retry.");
        const next = (await response.json()) as AppChatStatus;
        if (cancelled || requestController.signal.aborted) return;
        setStatus(next);
        setError(null);
        if (!next.sessionExpiresAt) {
          if (beginAppSignIn(sessionStorage, boot)) window.location.replace(appSignInUrl(next.appUrl, window.location.search));
          else setError("App sign-in could not finish. Allow app cookies and use Reconnect app after one minute.");
        }
      } catch (caught) {
        if (cancelled || (caught instanceof Error && caught.name === "AbortError")) return;
        setStatus(null);
        setError(caught instanceof Error ? caught.message : "Unable to load app.");
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(timer);
    };
  }, [boot.name, boot.hostGen, state.appsRevision, state.hydrationEpoch]);

  useEffect(() => {
    const openSettings = () => {
      window.open("/settings", "_blank", "noopener,noreferrer");
    };
    window.addEventListener(OPEN_ACCOUNT_SECTION_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_ACCOUNT_SECTION_EVENT, openSettings);
  }, []);

  useEffect(() => {
    if (!user || !state.connected) return;
    send({ type: "claim_user", username: user.username });
    dispatch({ type: "focus", agentId: open ? (agent?.id ?? null) : null });
    send({
      type: "presence_update",
      currentRoom: agent?.room ?? 0,
      currentRoomId: agent?.roomId ?? null,
      focusedAgentId: open ? (agent?.id ?? null) : null,
      viewMode: open && agent ? "log" : "away",
      device: getDevice(),
    });
  }, [user, state.connected, state.hydrationEpoch, agent?.id, agent?.room, agent?.roomId, open, dispatch]);

  useEffect(() => {
    if (!draftKey || !agent || restored.current === draftKey) return;
    restored.current = draftKey;
    skipDraftSave.current = true;
    try {
      dispatch({ type: "set_draft", agentId: agent.id, text: sessionStorage.getItem(draftKey) ?? "" });
    } catch {}
  }, [draftKey, agent?.id, dispatch]);
  useEffect(() => {
    if (!draftKey || restored.current !== draftKey) return;
    if (skipDraftSave.current) {
      skipDraftSave.current = false;
      return;
    }
    try {
      sessionStorage.setItem(draftKey, draft);
    } catch {}
  }, [draftKey, draft]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!status || !isAppSessionSignal(event, frame.current?.contentWindow ?? null, status.appUrl)) return;
      if (beginAppSignIn(sessionStorage, boot)) window.location.replace(appSignInUrl(status.appUrl, window.location.search));
      else setError("App sign-in could not finish. Allow app cookies and use Reconnect app after one minute.");
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [status?.appUrl, boot.name, boot.hostGen]);

  function reconnect() {
    if (!status) return;
    if (!beginAppSignIn(sessionStorage, boot)) {
      setError("App sign-in is limited to once a minute. Allow app cookies, then retry.");
      return;
    }
    window.location.assign(appSignInUrl(status.appUrl, window.location.search));
  }

  return (
    <>
      <style>{CSS}</style>
      <ConnectionBanner />
      <main style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--bg-base)", color: "var(--text-primary)" }}>
        <header style={{ display: "flex", flexWrap: "wrap", flexShrink: 0, alignItems: "center", gap: 12, padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
          <strong style={{ flex: 1 }}>{boot.name}</strong>
          <a href="/" target="_blank" rel="noopener noreferrer">
            Office
          </a>
          {status && (
            <>
              <a href={status.appUrl + window.location.search} target="_blank" rel="noopener noreferrer">
                Open app
              </a>
              <button onClick={reconnect}>Reconnect app</button>
              <button onClick={() => setFrameKey((key) => key + 1)}>Reload app</button>
            </>
          )}
          {agent && (
            <button aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "Close chat" : `Chat with ${agent.name}`}
            </button>
          )}
        </header>
        {error && (
          <p role="alert" style={{ padding: 12 }}>
            {error}
          </p>
        )}
        {!status && !error && <p role="status">Loading app…</p>}
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {status && (
            <iframe
              ref={frame}
              key={frameKey}
              title={boot.name}
              src={status.appUrl + window.location.search}
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-modals"
              style={{ display: open && state.isMobile ? "none" : "block", flex: 1, minWidth: 0, border: 0, background: "white" }}
            />
          )}
          {open && agent && user && (
            <section
              aria-label={`Chat with ${agent.name}`}
              style={{ width: state.isMobile ? "100%" : 440, maxWidth: "100%", minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border-subtle)" }}
            >
              <LogView
                embedded
                key={`${boot.hostGen}:${agent.id}`}
                agent={agent}
                logs={state.logs.get(agent.id) ?? []}
                username={user.username}
                onBack={() => setOpen(false)}
                onEditAgent={() => setEditing(true)}
              />
            </section>
          )}
        </div>
        {editing && agent && <EditAgentDialog agent={agent} onClose={() => setEditing(false)} />}
      </main>
    </>
  );
}
