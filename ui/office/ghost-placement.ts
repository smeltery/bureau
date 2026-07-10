import type { AgentInfo, PresenceInfo } from "../../shared/types.ts";
import { DESK_SLOTS, deskPixelPos } from "./grid.ts";

// "Outside SE wall" lobby coordinates. Until the desk repositioning in
// task 11384153 lands, idle ghosts can't fit anywhere on the floor;
// they line up here, past the SE wall. Adjacent ghosts step right by
// `GHOST_LOBBY_GAP` so the name tags don't collide.
const GHOST_LOBBY_BASE_X = 600;
const GHOST_LOBBY_BASE_Y = 590;
const GHOST_LOBBY_GAP = 52;

// Stack offsets for multiple bosses focused on the same agent. Small
// diagonal step so the second/third ghost peeks out from behind the
// first. The cap-3-visible + N-badge logic is intentionally NOT
// implemented in v1; a count of 4+ at one desk should be vanishingly
// rare given the office's user count.
const GHOST_STACK_DX = 18;
const GHOST_STACK_DY = 4;

export interface DoorCoord {
  left: number;
  top: number;
}

export interface GhostPlacement {
  presence: PresenceInfo;
  left: number;
  top: number;
  dimmed: boolean;
}

export function mapsEqual<K, V>(a: Map<K, V>, b: Map<K, V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

// Pixel placements for every ghost that should render in the current room
// (assuming they stay put, i.e. no door-transition override). Output is in
// input order, which the server sorts by connectionId, not grouped by anchor.
export function computeNaturalPlacements(presences: PresenceInfo[], roomAgents: AgentInfo[], currentRoom: number, ownConnectionId: string | null): GhostPlacement[] {
  const visible = presences.filter((p) => p.currentRoom === currentRoom && p.connectionId !== ownConnectionId);
  const groups = new Map<string, PresenceInfo[]>();
  for (const p of visible) {
    const agent = p.focusedAgentId !== null ? roomAgents.find((a) => a.id === p.focusedAgentId) : undefined;
    const key = agent ? `desk:${agent.desk}` : "lobby";
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }
  const rankByConn = new Map<string, { key: string; index: number }>();
  for (const [key, group] of groups) {
    group.forEach((p, index) => {
      rankByConn.set(p.connectionId, { key, index });
    });
  }
  const out: GhostPlacement[] = [];
  for (const p of visible) {
    const rank = rankByConn.get(p.connectionId);
    if (!rank) continue;
    const { key, index: i } = rank;
    let left: number;
    let top: number;
    if (key === "lobby") {
      left = GHOST_LOBBY_BASE_X + i * GHOST_LOBBY_GAP;
      top = GHOST_LOBBY_BASE_Y;
    } else {
      const deskIndex = Number(key.slice(5));
      const slot = DESK_SLOTS[deskIndex];
      if (!slot) continue;
      const { left: deskLeft, top: deskTop } = deskPixelPos(slot.row, slot.col);
      // SE of the chair. Chair anchor is (deskLeft+90, deskTop+116);
      // the ghost top-left sits a touch lower-right of that so the
      // body's visual centroid hovers near the chair shoulder. Layout
      // is intentionally cramped pre-desk-repositioning (task 11384153).
      left = deskLeft + 130 + i * GHOST_STACK_DX;
      top = deskTop + 90 + i * GHOST_STACK_DY;
    }
    out.push({
      presence: p,
      left,
      top,
      dimmed: p.viewMode === "away",
    });
  }
  return out;
}
