import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentInfo, PresenceInfo } from "../../shared/types.ts";
import { resolveGhostTransitionUpdate } from "./ghost-transition-detection.ts";
import { computeNaturalPlacements, type DoorCoord, type GhostPlacement } from "./ghost-placement.ts";

// CSS transition duration (ms) for ghost left/top — must match the
// `transition: left ... top ...` declaration in Ghost.tsx's motionStyle.
// Exit phantoms are removed 60ms after this to give the slide time to
// finish across paint-scheduling jitter.
const GHOST_TRANSITION_MS = 220;
const EXIT_PHANTOM_LIFETIME_MS = GHOST_TRANSITION_MS + 60;

export type { DoorCoord, GhostPlacement } from "./ghost-placement.ts";

// Owns the full pixel placement of every visible ghost — natural lobby /
// desk positions, door-slide overrides on room switches, and exit phantoms
// so departures animate to the door instead of popping out.
//
// Desk-to-desk slides (focus change inside a single room) and lobby-stack
// reshuffles are NOT managed here; they're a passive consequence of left/top
// changes flowing through Ghost.tsx's CSS `transition: left 220ms ease-out,
// top 220ms ease-out, opacity 220ms` declaration. This hook only adds the
// extra state needed to coordinate door slides, which can't be expressed as
// natural left/top changes because the React node would otherwise unmount
// (on exit) or fresh-mount at the wrong coord (on entry) before any
// transition could run.
//
// Detection runs SYNCHRONOUSLY during render via the React render-phase
// setState pattern: we hold `prevPresences` and `prevOwnRoom` in state,
// compare against the current props, and update state during the render
// that first sees a diff. React discards that render and re-renders with
// the new state — so the first paint after a presence_list room change
// already has door coords applied (for entry overrides) and exit phantoms
// inserted, keeping DOM element identity by connectionId across the
// natural -> phantom transition so the existing left/top CSS transition
// animates the slide instead of remount-popping.
//
// Direction rule: sign(currRoom - prevRoom) decides which door.
//   forward (positive): exit RIGHT (old room) / enter LEFT (new room).
//   backward (negative): exit LEFT (old room) / enter RIGHT (new room).
//
// No door animation when:
//   - the viewer themselves changed currentRoom (their movement, not the
//     other presence's): all in-flight state is cleared,
//   - the presence's prevRoom or currRoom is null (connect / disconnect /
//     crossing in or out of the recipient's visible projection),
//   - we've never seen this presence before (initial mount of its entry).
export function useGhostTransitions(
  presences: PresenceInfo[],
  roomAgents: AgentInfo[],
  currentRoom: number,
  ownConnectionId: string | null,
  leftDoor: DoorCoord,
  rightDoor: DoorCoord,
): GhostPlacement[] {
  const [entering, setEntering] = useState<Map<string, DoorCoord>>(() => new Map());
  const [exiting, setExiting] = useState<Map<string, GhostPlacement>>(() => new Map());
  // `prevPresences` / `prevOwnRoom` are kept in STATE (not refs) so the
  // render-phase compare-and-update pattern is a pure function of state
  // and props. Refs would also work but would be a side-effect mutation
  // during render, which strict-mode double-renders catch.
  const [prevPresences, setPrevPresences] = useState<PresenceInfo[]>(presences);
  const [prevOwnRoom, setPrevOwnRoom] = useState<number>(currentRoom);

  // Map<cid, prevRoom> derived from prevPresences. Recomputed only when
  // prevPresences changes (i.e., when we accept a new diff into state).
  const prevRoomByCid = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const p of prevPresences) m.set(p.connectionId, p.currentRoom);
    return m;
  }, [prevPresences]);

  // Effect-managed bookkeeping. Not read in render.
  const exitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const enteringRafsRef = useRef<Map<string, { raf1: number; raf2: number | null }>>(new Map());

  // Render-phase derived-state pattern. When `presences` or `currentRoom`
  // change (compared by reference / value to the snapshot in state), detect
  // transitions and update state IN THIS render so the same render's return
  // value reflects them. React discards the just-returned output and
  // re-renders with the updated state before painting.
  if (presences !== prevPresences || currentRoom !== prevOwnRoom) {
    const update = resolveGhostTransitionUpdate({
      presences,
      currentRoom,
      prevOwnRoom,
      prevRoomByCid,
      entering,
      exiting,
      leftDoor,
      rightDoor,
    });
    if (update.entering) setEntering(update.entering);
    if (update.exiting) setExiting(update.exiting);

    setPrevPresences(presences);
    setPrevOwnRoom(currentRoom);
  }

  // Sync rAF schedule to current `entering` state. New cids in `entering`
  // get a two-rAF schedule whose inner callback removes the cid from
  // entering (per-cid, so multiple staggered arrivals each get their own
  // door-coord paint window). Removed cids get their rAFs cancelled.
  useEffect(() => {
    for (const [cid] of entering) {
      if (!enteringRafsRef.current.has(cid)) {
        const raf1 = requestAnimationFrame(() => {
          const raf2 = requestAnimationFrame(() => {
            enteringRafsRef.current.delete(cid);
            setEntering((curr) => {
              if (!curr.has(cid)) return curr;
              const next = new Map(curr);
              next.delete(cid);
              return next;
            });
          });
          const entry = enteringRafsRef.current.get(cid);
          if (entry) entry.raf2 = raf2;
        });
        enteringRafsRef.current.set(cid, { raf1, raf2: null });
      }
    }
    for (const cid of Array.from(enteringRafsRef.current.keys())) {
      if (!entering.has(cid)) {
        const r = enteringRafsRef.current.get(cid);
        if (r !== undefined) {
          cancelAnimationFrame(r.raf1);
          if (r.raf2 !== null) cancelAnimationFrame(r.raf2);
        }
        enteringRafsRef.current.delete(cid);
      }
    }
  }, [entering]);

  // Sync removal-timer schedule to current `exiting` state.
  useEffect(() => {
    for (const [cid] of exiting) {
      if (!exitTimersRef.current.has(cid)) {
        const t = setTimeout(() => {
          exitTimersRef.current.delete(cid);
          setExiting((curr) => {
            if (!curr.has(cid)) return curr;
            const next = new Map(curr);
            next.delete(cid);
            return next;
          });
        }, EXIT_PHANTOM_LIFETIME_MS);
        exitTimersRef.current.set(cid, t);
      }
    }
    for (const cid of Array.from(exitTimersRef.current.keys())) {
      if (!exiting.has(cid)) {
        const t = exitTimersRef.current.get(cid);
        if (t !== undefined) clearTimeout(t);
        exitTimersRef.current.delete(cid);
      }
    }
  }, [exiting]);

  // Cancel all pending timers / rAFs on unmount.
  useEffect(
    () => () => {
      for (const t of exitTimersRef.current.values()) clearTimeout(t);
      exitTimersRef.current.clear();
      for (const r of enteringRafsRef.current.values()) {
        cancelAnimationFrame(r.raf1);
        if (r.raf2 !== null) cancelAnimationFrame(r.raf2);
      }
      enteringRafsRef.current.clear();
    },
    [],
  );

  // Final placement list: natural placements with entering overrides
  // applied, plus exit phantoms for any cid that just left, sorted by
  // connectionId so React's child order stays stable across all the
  // merge variants. This is the invariant Ghost.tsx's two-layer split
  // relies on to keep inline CSS transitions from re-attach-restarting.
  const naturalPlacements = useMemo(() => computeNaturalPlacements(presences, roomAgents, currentRoom, ownConnectionId), [presences, roomAgents, currentRoom, ownConnectionId]);

  return useMemo(() => {
    const byCid = new Map<string, GhostPlacement>();
    for (const p of naturalPlacements) {
      const override = entering.get(p.presence.connectionId);
      byCid.set(p.presence.connectionId, override !== undefined ? { ...p, left: override.left, top: override.top } : p);
    }
    for (const [cid, phantom] of exiting) {
      if (!byCid.has(cid)) byCid.set(cid, phantom);
    }
    return Array.from(byCid.values()).sort((a, b) => a.presence.connectionId.localeCompare(b.presence.connectionId));
  }, [naturalPlacements, entering, exiting]);
}
