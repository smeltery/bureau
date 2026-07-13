import type { PresenceInfo } from "../../shared/types.ts";
import { mapsEqual, type DoorCoord, type GhostPlacement } from "./ghost-placement.ts";

export type GhostTransitionUpdate = {
  entering: Map<string, DoorCoord> | null;
  exiting: Map<string, GhostPlacement> | null;
};

export function resolveGhostTransitionUpdate(opts: {
  presences: PresenceInfo[];
  currentRoom: number;
  prevOwnRoom: number;
  prevRoomByCid: Map<string, number | null>;
  entering: Map<string, DoorCoord>;
  exiting: Map<string, GhostPlacement>;
  leftDoor: DoorCoord;
  rightDoor: DoorCoord;
}): GhostTransitionUpdate {
  const { presences, currentRoom, prevOwnRoom, prevRoomByCid, entering, exiting, leftDoor, rightDoor } = opts;

  if (prevOwnRoom !== currentRoom) {
    return {
      entering: entering.size > 0 ? new Map() : null,
      exiting: exiting.size > 0 ? new Map() : null,
    };
  }

  const newEnteringEntries = new Map<string, DoorCoord>();
  const newExitingEntries = new Map<string, GhostPlacement>();
  for (const presence of presences) {
    const prevRoom = prevRoomByCid.get(presence.connectionId);
    const currRoom = presence.currentRoom;
    if (prevRoom === undefined) continue;
    if (prevRoom === currRoom) continue;
    if (prevRoom === null || currRoom === null) continue;

    const goingForward = currRoom > prevRoom;
    if (prevRoom === currentRoom) {
      const door = goingForward ? rightDoor : leftDoor;
      newExitingEntries.set(presence.connectionId, {
        presence,
        left: door.left,
        top: door.top,
        dimmed: presence.viewMode === "away",
      });
    } else if (currRoom === currentRoom) {
      newEnteringEntries.set(presence.connectionId, goingForward ? leftDoor : rightDoor);
    }
  }

  return {
    entering: mergeEnteringOverrides(entering, newEnteringEntries),
    exiting: mergeExitingPhantoms(exiting, newEnteringEntries, newExitingEntries),
  };
}

function mergeEnteringOverrides(current: Map<string, DoorCoord>, detected: Map<string, DoorCoord>): Map<string, DoorCoord> | null {
  if (detected.size === 0) return null;
  const merged = new Map(current);
  let changed = false;
  for (const [cid, door] of detected) {
    if (merged.get(cid) !== door) {
      merged.set(cid, door);
      changed = true;
    }
  }
  return changed ? merged : null;
}

function mergeExitingPhantoms(current: Map<string, GhostPlacement>, entering: Map<string, DoorCoord>, detected: Map<string, GhostPlacement>): Map<string, GhostPlacement> | null {
  const rebounds = Array.from(entering.keys()).filter((cid) => current.has(cid));
  if (detected.size === 0 && rebounds.length === 0) return null;

  const merged = new Map(current);
  for (const cid of rebounds) merged.delete(cid);
  for (const [cid, phantom] of detected) merged.set(cid, phantom);
  return mapsEqual(current, merged) ? null : merged;
}
