import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { deleteUserById, getUserById, getUserByName, updateUserById } from "../users.ts";
import { acceptInvite, mintInvite, peekInvite, revokeInvitesForUser } from "./auth.ts";

const created: string[] = [];
afterEach(() => {
  for (const id of created.splice(0)) deleteUserById(id);
});

async function mintMember(username = `Up Front ${randomUUID()}`) {
  const minted = await mintInvite({ username, role: "member", createdBy: "Owner", allowExisting: false });
  if (!minted.ok) throw new Error(minted.error);
  const user = getUserByName(username)!;
  created.push(user.id);
  return { minted, user };
}

describe("members created up front", () => {
  test("issuing an invite creates the member, pending until a link is accepted", async () => {
    const { minted, user } = await mintMember();
    expect(user.pendingSignIn).toBe(true);
    expect(minted.invite.userId).toBe(user.id);

    const accepted = await acceptInvite(minted.rawToken, { userAgent: null });
    expect(accepted.ok).toBe(true);
    expect(getUserById(user.id)?.pendingSignIn).toBeUndefined();
  });

  test("a link signs in the same member after a rename", async () => {
    const { minted, user } = await mintMember();
    const renamed = `Renamed ${randomUUID()}`;
    expect(updateUserById(user.id, { name: renamed }).ok).toBe(true);

    const peek = peekInvite(minted.rawToken);
    expect("username" in peek && peek.username).toBe(renamed);
    const accepted = await acceptInvite(minted.rawToken, { userAgent: null });
    expect(accepted.ok && accepted.username).toBe(renamed);
    expect(getUserByName(minted.invite.username!)).toBeNull();
  });

  test("a deleted member's link signs nobody in", async () => {
    const { minted, user } = await mintMember();
    deleteUserById(user.id);

    expect(peekInvite(minted.rawToken)).toEqual({ error: "not_found" });
    expect(await acceptInvite(minted.rawToken, { userAgent: null })).toEqual({ ok: false, error: "not_found" });
    expect(getUserByName(minted.invite.username!)).toBeNull();
  });

  test("deleting a member revokes their outstanding links", async () => {
    const { minted, user } = await mintMember();
    expect(await revokeInvitesForUser(user.id, user.name)).toBe(1);
    expect(peekInvite(minted.rawToken)).toEqual({ error: "not_found" });
  });

  test("another link for a pending member binds to the same record", async () => {
    const { minted, user } = await mintMember();
    const again = await mintInvite({ username: user.name, role: "member", createdBy: "Owner", allowExisting: false });
    expect(again.ok).toBe(false);

    const resend = await mintInvite({ username: user.name, role: "member", createdBy: "Owner", allowExisting: true });
    if (!resend.ok) throw new Error(resend.error);
    expect(resend.invite.userId).toBe(user.id);
    expect(minted.invite.userId).toBe(user.id);
  });
});
