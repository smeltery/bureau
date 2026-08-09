import type { ServerWebSocket } from "bun";
import type { ServerMessage } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { closeEditorWatchesFor } from "../editor-watchers.ts";
import { removePresence } from "../presence.ts";
import { clearWsUser, claimUser, getSessionContext, setWsSessionPrefix } from "../users.ts";
import { revalidateByHash, registerSocket, unregisterSocket, type SessionLookup } from "../auth/auth.ts";
import { pushPresenceListToEachWs, sendInitialPayload } from "../ws-initial-payload.ts";
import { browsers } from "./broadcast.ts";
import { dispatchBrowserCommand } from "./command-dispatch.ts";
import { handleCommand } from "./commands.ts";
import { appRelaySocketMessage, closeAppRelaySocket, isAppRelaySocket, openAppRelaySocket, type AppRelayWsData } from "../apps/host/ws-relay.ts";

// Per-WS auth context. Set at upgrade; cleared at close. OfficeWsData carries
// the session lookup so per-message rechecks can revoke active connections
// within ~1s of an Access-pane revoke. Loopback connections (agents on the
// same host) skip auth and run with `session === null`.
//
// The office's own socket. One `Bun.serve` serves the office AND every app
// hostname, and a Bun server has exactly one set of websocket callbacks — so
// `WsData` is a union and each callback below tells the two apart before
// anything else runs. NOTHING of the office's machinery may run for an
// app-relay socket: no roster, no presence, no command parsing.
export interface OfficeWsData {
  session: SessionLookup | null;
}

export type WsData = OfficeWsData | AppRelayWsData;

export function openBrowserWebSocket(ws: ServerWebSocket<WsData>): void {
  if (isAppRelaySocket(ws.data)) {
    openAppRelaySocket(ws as ServerWebSocket<AppRelayWsData>);
    return;
  }
  openOfficeWebSocket(ws as ServerWebSocket<OfficeWsData>);
}

export function handleBrowserWebSocketMessage(ws: ServerWebSocket<WsData>, message: string | Buffer): void | Promise<void> {
  if (isAppRelaySocket(ws.data)) {
    // Synchronous on purpose: a relayed frame must not wait behind the office's
    // per-message session recheck, and there is nothing to recheck for it.
    appRelaySocketMessage(ws as ServerWebSocket<AppRelayWsData>, message);
    return;
  }
  return handleOfficeWebSocketMessage(ws as ServerWebSocket<OfficeWsData>, message);
}

export function closeBrowserWebSocket(ws: ServerWebSocket<WsData>, code?: number, reason?: string): void {
  if (isAppRelaySocket(ws.data)) {
    closeAppRelaySocket(ws as ServerWebSocket<AppRelayWsData>, code ?? 1006, reason ?? "");
    return;
  }
  closeOfficeWebSocket(ws as ServerWebSocket<OfficeWsData>);
}

function openOfficeWebSocket(ws: ServerWebSocket<OfficeWsData>): void {
  browsers.add(ws);
  const session = ws.data?.session ?? null;
  if (session) {
    registerSocket(session.sessionIdHash, ws);
    // Bind the WS to the authenticated user record automatically. The
    // user already exists in users.json (created via the invite/claim
    // flow); this hooks the WS into the existing per-WS lifecycle
    // (wsUsers / sessionPrefixes / connectedAt) that the rest of
    // bureau's command handlers depend on. claim_user is still wired
    // for loopback connections (agents on the same host) that arrive
    // without a session.
    claimUser(ws, session.username, AgentManager.getRooms());
    // Install the real auth-session prefix so SessionContext.currentSessionPrefix
    // matches the Access pane's session row for self-detection.
    setWsSessionPrefix(ws, session.sessionPrefix);
  }
  sendInitialPayload(ws);
}

async function handleOfficeWebSocketMessage(ws: ServerWebSocket<OfficeWsData>, data: string | Buffer): Promise<void> {
  // Per-message session recheck so a revoke from the Access pane disconnects
  // an active connection within ~1s. Loopback connections skip the check.
  const session = ws.data?.session ?? null;
  if (session) {
    const current = revalidateByHash(session.sessionIdHash);
    if (!current) {
      try {
        ws.send(JSON.stringify({ type: "session_expired" } as ServerMessage));
      } catch {}
      try {
        ws.close();
      } catch {}
      return;
    }
  }
  await dispatchBrowserCommand(ws, data, handleCommand);
}

function closeOfficeWebSocket(ws: ServerWebSocket<OfficeWsData>): void {
  browsers.delete(ws);
  const session = ws.data?.session ?? null;
  if (session) unregisterSocket(session.sessionIdHash, ws);
  if (getSessionContext(ws)?.connectionId && removePresence(getSessionContext(ws)!.connectionId)) {
    pushPresenceListToEachWs();
  }
  clearWsUser(ws);
  closeEditorWatchesFor(ws);
}
