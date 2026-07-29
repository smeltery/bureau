import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { closeEditorWatchesFor } from "../editor-watchers.ts";
import { removePresence } from "../presence.ts";
import { clearWsUser, claimUser, getSessionContext, setWsSessionPrefix } from "../users.ts";
import { revalidateByHash, registerSocket, unregisterSocket, type SessionLookup } from "../auth/auth.ts";
import { pushPresenceListToEachWs, sendInitialPayload } from "../ws-initial-payload.ts";
import { browsers } from "./broadcast.ts";
import { handleCommand } from "./commands.ts";

// Per-WS auth context. Set at upgrade; cleared at close. WsData carries the
// session lookup so per-message rechecks can revoke active connections
// within ~1s of an Access-pane revoke. Loopback connections (agents on the
// same host) skip auth and run with `session === null`.
export interface WsData {
  session: SessionLookup | null;
}

export function openBrowserWebSocket(ws: ServerWebSocket<WsData>): void {
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

type CommandDispatch = (cmd: ClientCommand, ws: ServerWebSocket<WsData>) => Promise<void> | void;

export async function dispatchBrowserCommand(ws: ServerWebSocket<WsData>, data: string | Buffer, dispatch: CommandDispatch = handleCommand): Promise<void> {
  try {
    const cmd = JSON.parse(data as string) as ClientCommand;
    await dispatch(cmd, ws);
  } catch (e) {
    console.error("Invalid command:", e);
  }
}

export async function handleBrowserWebSocketMessage(ws: ServerWebSocket<WsData>, data: string | Buffer): Promise<void> {
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
  await dispatchBrowserCommand(ws, data);
}

export function closeBrowserWebSocket(ws: ServerWebSocket<WsData>): void {
  browsers.delete(ws);
  const session = ws.data?.session ?? null;
  if (session) unregisterSocket(session.sessionIdHash, ws);
  if (getSessionContext(ws)?.connectionId && removePresence(getSessionContext(ws)!.connectionId)) {
    pushPresenceListToEachWs();
  }
  clearWsUser(ws);
  closeEditorWatchesFor(ws);
}
