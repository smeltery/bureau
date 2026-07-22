import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import * as AgentManager from "../agent-manager.ts";
import { getUserByName } from "../users.ts";
import { acceptInvite, mintInvite, setRoomsSnapshotProvider } from "./auth.ts";

describe("invite room grants", () => {
  test("member invite grants seed accepted user rooms and notifications", async () => {
    setRoomsSnapshotProvider(() => AgentManager.getRooms().map((room) => room.id));
    const rooms = AgentManager.getRooms();
    const grantedRooms = rooms.slice(0, 2).map((room) => room.id);
    const username = `Invite Grant ${randomUUID()}`;

    const minted = await mintInvite({
      username,
      role: "member",
      createdBy: "Owner",
      allowExisting: false,
      allowedRooms: grantedRooms,
    });
    if (!minted.ok) throw new Error(minted.error);

    expect(minted.invite.allowedRooms).toEqual(grantedRooms);

    const accepted = await acceptInvite(minted.rawToken, { userAgent: null });
    if (!accepted.ok) throw new Error(accepted.error);

    const user = getUserByName(username);
    expect(user?.role).toBe("member");
    expect(user?.allowedRooms).toEqual(grantedRooms);
    expect(user?.notifRooms).toEqual(grantedRooms);
  });

  test("invite room grants require known rooms on new member invites", async () => {
    setRoomsSnapshotProvider(() => AgentManager.getRooms().map((room) => room.id));
    const unknown = await mintInvite({
      username: `Invite Grant ${randomUUID()}`,
      role: "member",
      createdBy: "Owner",
      allowExisting: false,
      allowedRooms: ["missing-room"],
    });

    expect(unknown).toEqual({
      ok: false,
      error: "allowedRooms contains an unknown room id",
      code: "INVALID_ALLOWED_ROOMS",
    });

    const ownerGrant = await mintInvite({
      username: `Invite Grant ${randomUUID()}`,
      role: "owner",
      createdBy: "Owner",
      allowExisting: false,
      allowedRooms: [AgentManager.getRooms()[0]!.id],
    });

    expect(ownerGrant).toEqual({
      ok: false,
      error: "Room grants are only supported for member invites",
      code: "INVALID_ALLOWED_ROOMS",
    });
  });
});
