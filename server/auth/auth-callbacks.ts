import type { ServerMessage } from "../../shared/types.ts";
import type { RoomWire } from "../../shared/types.ts";
import { browsers } from "../ws/broadcast.ts";
import { getWsUser } from "../users.ts";
import { listActiveSessions, listInvites, setOnInviteConsumed, setOnSessionsChanged, setRoomsSnapshotProvider } from "./auth.ts";
import { setOnOwnerCreated } from "./auth-routes.ts";

export function installAuthCallbacks(getRooms: () => RoomWire[]) {
  // Inject the room snapshot provider auth.ts uses when seeding a new owner's
  // allowedRooms at invite-acceptance time. The provider closes over room state
  // rather than auth.ts importing agent-manager directly.
  setRoomsSnapshotProvider(() => getRooms().map((r) => r.id));

  // Invite consumption often happens via HTTP POST /auth/accept, outside the
  // WS dispatch loop, so fan out updated owner-only access data here.
  setOnInviteConsumed(() => {
    for (const browser of browsers) {
      const user = getWsUser(browser);
      if (user?.role === "owner") {
        browser.send(JSON.stringify({ type: "invites_list", invites: listInvites() } as ServerMessage));
        browser.send(JSON.stringify({ type: "sessions_active_list", sessions: listActiveSessions() } as ServerMessage));
      }
    }
  });

  // Owner sessions table stays fresh on server-initiated session invalidation:
  // revoke, logout, delete-user fanout, and expiry/orphan cleanup paths.
  setOnSessionsChanged(() => {
    for (const browser of browsers) {
      const user = getWsUser(browser);
      if (user?.role === "owner") {
        browser.send(JSON.stringify({ type: "sessions_active_list", sessions: listActiveSessions() } as ServerMessage));
      }
    }
  });

  // First-claim hook: seed the office when the first owner is created. Bureau
  // starts empty for now; this is the supported extension point for future
  // welcome agents.
  setOnOwnerCreated(async ({ username }) => {
    void username;
  });
}
