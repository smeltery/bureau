import { afterEach, expect, test } from "bun:test";
import { rmSync } from "fs";
import { freezeAppHostDomain } from "../../apps/domain.ts";
import { createFetchHandler } from "../../http/router.ts";
import { _testResetApiTokens, mintApiToken } from "../api-tokens.ts";
import { API_TOKENS_FILE } from "../../persistence/paths.ts";
import { claimUserByName, deleteUserById, getUserByName } from "../../users.ts";

const USERNAME = "Socket Token Tester";

afterEach(() => {
  _testResetApiTokens();
  const user = getUserByName(USERNAME);
  if (user) deleteUserById(user.id);
  rmSync(API_TOKENS_FILE, { force: true });
});

// A socket without a browser session is never rechecked and may claim any
// member, so a personal API token must not open one.
test("a personal API token cannot open the office socket", async () => {
  freezeAppHostDomain();
  const user = claimUserByName(USERNAME, { role: "member", allowedRooms: [] });
  const { token } = await mintApiToken({ userId: user.id, name: "script", expiresInDays: 30 });
  let upgraded = false;
  const server = {
    requestIP: () => ({ address: "203.0.113.9", port: 12345, family: "IPv4" }),
    upgrade: () => (upgraded = true),
  } as never;
  const req = new Request("http://local.test/ws", { headers: { Authorization: `Bearer ${token}`, Upgrade: "websocket", Connection: "Upgrade" } });
  const res = await createFetchHandler()(req, server);
  expect(upgraded).toBe(false);
  expect(res?.status).toBe(403);
});
