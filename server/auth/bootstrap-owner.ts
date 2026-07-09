import type { UserRecord } from "../../shared/types.ts";
import { claimUserByName, deleteUserById, getUserById, getUserByName, setUserRoleById, updateUserById } from "../users.ts";

// Injected by server/index.ts at boot. New owners need a snapshot of every
// current room id as their initial allowedRooms (the strict string[] model
// has no "all" sentinel, so "owners see every room" has to be materialized
// at creation time). This module intentionally stays free of agent-manager
// dependencies; the provider sidesteps a cycle.
let roomsSnapshotProvider: (() => string[]) | null = null;

export function setRoomsSnapshotProvider(fn: () => string[]): void {
  roomsSnapshotProvider = fn;
}

export function snapshotRoomIds(): string[] {
  return roomsSnapshotProvider ? roomsSnapshotProvider() : [];
}

// Owner-creation core used by both the tokenless claim form (claimOwnership)
// and the legacy bootstrap-invite acceptance path (acceptInvite bootstrap
// branch). Mutates user state so the named user becomes an owner with full
// allowedRooms, then returns the resulting user record alongside a rollback
// closure that restores the prior state.
export function commitBootstrapOwnerUser(chosenName: string): {
  user: UserRecord;
  rollback: () => void;
} {
  const existing = getUserByName(chosenName);
  if (!existing) {
    const created = claimUserByName(chosenName, {
      role: "owner",
      allowedRooms: snapshotRoomIds(),
    });
    const createdId = created.id;
    return {
      user: created,
      rollback: () => {
        try {
          deleteUserById(createdId);
        } catch (err) {
          console.error(
            `[auth] catastrophic: bootstrap rollback could not delete just-created user ${createdId}; the office is now stranded with an owner record but no session. Once the underlying disk issue is fixed, try the owner-login recovery CLI ('bun run server/index.ts owner-login --name <chosen-name>') against the running server; if the partial record is malformed, remove ${createdId} from users.json by hand and re-open the claim form.`,
            err,
          );
        }
      },
    };
  }

  const prevRole = existing.role;
  const prevAllowedRooms = [...existing.allowedRooms];
  const userId = existing.id;
  const restorePriorState = () => {
    try {
      setUserRoleById(userId, prevRole);
    } catch (err) {
      console.error(`[auth] bootstrap rollback: setUserRoleById restore to ${prevRole} threw for ${userId}`, err);
    }
    try {
      const rr = updateUserById(userId, { allowedRooms: prevAllowedRooms });
      if (!rr.ok) {
        console.error(`[auth] bootstrap rollback: allowedRooms restore returned not-ok for ${userId}: ${rr.error}`);
      }
    } catch (err) {
      console.error(`[auth] bootstrap rollback: allowedRooms restore threw for ${userId}`, err);
    }
  };

  const snapshot = snapshotRoomIds();
  const r = updateUserById(userId, { allowedRooms: snapshot });
  if (!r.ok) {
    throw new Error(`bootstrap owner promotion: allowedRooms write failed for ${existing.name}: ${r.error}`);
  }
  if (existing.role !== "owner") {
    try {
      setUserRoleById(userId, "owner");
    } catch (err) {
      restorePriorState();
      throw err;
    }
  }
  const updated = getUserById(userId);
  if (!updated) {
    restorePriorState();
    throw new Error(`bootstrap owner promotion: user ${userId} vanished mid-flow; rolled allowedRooms/role back to prior state`);
  }
  return { user: updated, rollback: restorePriorState };
}
