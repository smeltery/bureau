import type { ServerWebSocket } from "bun";
import type { BrowserHumanInput, ClientCommand, ServerMessage } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { officeConfig } from "../agents/state.ts";
import { BROWSER_MAX_DIM, BROWSER_MIN_DIM, browserPool, normalizeBrowserDpr } from "../browser/session.ts";
import { getWsUser } from "../users.ts";
import { canUseRoom } from "./user-commands.ts";

export type BrowserCommand = Extract<ClientCommand, { type: "browser_watch" | "browser_input" }>;

const watches = new WeakMap<ServerWebSocket<unknown>, Map<string, () => void>>();

function canUseAgent(ws: ServerWebSocket<unknown>, agentId: string): boolean {
  const agent = AgentManager.getAllAgents().find((a) => a.id === agentId);
  if (!agent) return false;
  const roomId = AgentManager.getRooms()[agent.room]?.id;
  return !!roomId && canUseRoom(ws, roomId);
}

function canManageAgent(ws: ServerWebSocket<unknown>, agentId: string): boolean {
  const user = getWsUser(ws);
  const agent = AgentManager.getAllAgents().find((a) => a.id === agentId);
  return !!user && !!agent && (user.role === "owner" || agent.userId === user.id);
}

function validBound(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= BROWSER_MIN_DIM && value <= BROWSER_MAX_DIM;
}

function validInput(input: BrowserHumanInput): boolean {
  if (input.kind === "selection") return Number.isSafeInteger(input.requestId) && input.requestId > 0;
  if (input.kind === "mouse") {
    return Number.isFinite(input.x) && Number.isFinite(input.y) && (input.event === "mousePressed" || input.event === "mouseReleased" || input.event === "mouseMoved" || input.event === "mouseWheel");
  }
  return typeof input.key === "string" && input.key.length > 0;
}

function stopWatch(ws: ServerWebSocket<unknown>, agentId: string): void {
  const map = watches.get(ws);
  const stop = map?.get(agentId);
  if (!stop) return;
  stop();
  map!.delete(agentId);
  if (!map!.size) watches.delete(ws);
}

export function closeBrowserWatchesFor(ws: ServerWebSocket<unknown>): void {
  const map = watches.get(ws);
  if (!map) return;
  for (const stop of map.values()) stop();
  watches.delete(ws);
}

export async function handleBrowserCommand(cmd: BrowserCommand, ws: ServerWebSocket<unknown>): Promise<boolean> {
  if (!officeConfig.experimental.browserPanel) return true;
  if (!canUseAgent(ws, cmd.agentId)) return true;

  if (cmd.type === "browser_watch") {
    stopWatch(ws, cmd.agentId);
    if (!cmd.watching) return true;
    if ((cmd.maxWidth !== undefined && !validBound(cmd.maxWidth)) || (cmd.maxHeight !== undefined && !validBound(cmd.maxHeight))) return true;
    if (cmd.deviceScaleFactor !== undefined && (typeof cmd.deviceScaleFactor !== "number" || !Number.isFinite(cmd.deviceScaleFactor))) return true;
    browserPool.setPublicHostAllowlist(officeConfig.previewAllowHosts);
    let previous = "";
    const stop = browserPool.watch(
      cmd.agentId,
      (frame) => {
        const state = browserPool.status(cmd.agentId);
        const status = JSON.stringify({ type: "browser_status", agentId: cmd.agentId, ...state } satisfies ServerMessage);
        if (status !== previous) {
          ws.send(status);
          previous = status;
        }
        if (frame && state.available) {
          ws.send(JSON.stringify({ type: "browser_frame", agentId: cmd.agentId, ...frame } satisfies ServerMessage));
        }
      },
      {
        maxWidth: cmd.maxWidth,
        maxHeight: cmd.maxHeight,
        deviceScaleFactor: normalizeBrowserDpr(cmd.deviceScaleFactor),
      },
    );
    let map = watches.get(ws);
    if (!map) {
      map = new Map();
      watches.set(ws, map);
    }
    map.set(cmd.agentId, stop);
    return true;
  }

  // Input (mouse/key/selection) is manager-only.
  if (!canManageAgent(ws, cmd.agentId) || !validInput(cmd.input)) return true;
  if (cmd.input.kind === "selection") {
    let result: { text: string; truncated: boolean; error?: string };
    try {
      result = await browserPool.selection(cmd.agentId);
    } catch {
      result = { text: "", truncated: false, error: "selection_failed" };
    }
    if (canManageAgent(ws, cmd.agentId)) {
      ws.send(JSON.stringify({ type: "browser_selection", agentId: cmd.agentId, requestId: cmd.input.requestId, ...result } satisfies ServerMessage));
    }
    return true;
  }
  await browserPool.humanInput(cmd.agentId, cmd.input);
  return true;
}
