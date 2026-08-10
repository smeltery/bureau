// The access-control WS commands, which had no test.
//
// This is the surface the privileged-agent audit deliberately refuses to let an
// agent near: invites mint durable human logins, and session revocation kills a
// human's browser session. The gate that keeps those owner-only lives here, in a
// switch where each arm re-reads the socket's user and decides for itself — so a
// missing check is one arm quietly wide open rather than a compile error.
//
// Every assertion is a refusal, and each is mutation-verified. The tests lean on
// the arms that refuse BEFORE mutating anything, which is both where the
// security value sits and what can be asserted without minting real invites into
// the shared state directory this suite runs against.

import { afterEach, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage } from "../../../shared/types.ts";
import { claimUserByName, deleteUserById } from "../../users.ts";
import { bindWsUser, clearWsUser } from "../../user-sockets.ts";
import { handleAccessCommand } from "../access-commands.ts";

const createdUserIds: string[] = [];
const boundSockets: ServerWebSocket<unknown>[] = [];

afterEach(() => {
  for (const ws of boundSockets.splice(0)) clearWsUser(ws);
  for (const id of createdUserIds.splice(0)) deleteUserById(id);
});

/** A socket that records what the server sent it. */
function socket(): { ws: ServerWebSocket<unknown>; sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  const ws = {
    send(data: string) {
      sent.push(JSON.parse(data) as ServerMessage);
    },
  } as unknown as ServerWebSocket<unknown>;
  return { ws, sent };
}

/** An unauthenticated socket: connected, but with no user bound to it. */
function anonymous() {
  return socket();
}

function withUser(role: "owner" | "member") {
  const s = socket();
  const user = claimUserByName(`Access Test ${role} ${crypto.randomUUID()}`, { role });
  createdUserIds.push(user.id);
  bindWsUser(s.ws, user);
  boundSockets.push(s.ws);
  return { ...s, user };
}

const mintInviteCmd = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    type: "mint_invite",
    requestId: "req-1",
    username: `Invitee ${crypto.randomUUID()}`,
    role: "member",
    ...over,
  }) as unknown as ClientCommand;

describe("mint_invite is owner-only", () => {
  test("a member is refused and pointed at their own self-invite instead", async () => {
    // The boundary that matters: a member minting an invite could hand out a
    // durable login for ANY username, including an owner one.
    const { ws, sent } = withUser("member");

    const handled = await handleAccessCommand(mintInviteCmd(), ws);

    expect(handled).toBe(true);
    expect(sent).toHaveLength(1);
    const reply = sent[0] as ServerMessage & { ok?: boolean; error?: string; url?: string };
    expect(reply.type).toBe("invite_minted");
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain("Only owners can mint invites");
    // No URL, so a refused mint cannot leak a usable link.
    expect(reply.url).toBeUndefined();
  });

  test("a member cannot mint an OWNER invite either", async () => {
    const { ws, sent } = withUser("member");

    await handleAccessCommand(mintInviteCmd({ role: "owner" }), ws);

    const reply = sent[0] as ServerMessage & { ok?: boolean; url?: string };
    expect(reply.ok).toBe(false);
    expect(reply.url).toBeUndefined();
  });

  test("a socket with no user bound is refused too", async () => {
    const { ws, sent } = anonymous();

    const handled = await handleAccessCommand(mintInviteCmd(), ws);

    expect(handled).toBe(true);
    const reply = sent[0] as ServerMessage & { ok?: boolean; url?: string };
    expect(reply.ok).toBe(false);
    expect(reply.url).toBeUndefined();
  });
});

describe("an unauthenticated socket learns nothing", () => {
  test("list_active_sessions answers with an empty list rather than the office's sessions", async () => {
    const { ws, sent } = anonymous();

    const handled = await handleAccessCommand({ type: "list_active_sessions" } as ClientCommand, ws);

    expect(handled).toBe(true);
    expect(sent).toEqual([{ type: "sessions_active_list", sessions: [] }]);
  });

  test("list_invites, revoke_invite and revoke_session are swallowed without a reply", async () => {
    // Handled (so nothing falls through to another dispatcher) but silent: no
    // list, no confirmation, and nothing mutated.
    for (const cmd of [{ type: "list_invites" }, { type: "revoke_invite", tokenPrefix: "abcd1234" }, { type: "revoke_session", sessionPrefix: "abcd1234" }]) {
      const { ws, sent } = anonymous();

      const handled = await handleAccessCommand(cmd as ClientCommand, ws);

      expect(handled).toBe(true);
      expect(sent).toEqual([]);
    }
  });

  test("mint_self_invite refuses when the socket has no user record", async () => {
    const { ws, sent } = anonymous();

    await handleAccessCommand({ type: "mint_self_invite", requestId: "req-2" } as unknown as ClientCommand, ws);

    const reply = sent[0] as ServerMessage & { ok?: boolean; error?: string; url?: string };
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain("user record is missing");
    expect(reply.url).toBeUndefined();
  });
});

describe("dispatch", () => {
  test("a command this module does not own is passed back, not swallowed", async () => {
    // Returning true here would make an unrelated command vanish silently.
    const { ws, sent } = anonymous();

    expect(await handleAccessCommand({ type: "not_an_access_command" } as unknown as ClientCommand, ws)).toBe(false);
    expect(sent).toEqual([]);
  });
});
