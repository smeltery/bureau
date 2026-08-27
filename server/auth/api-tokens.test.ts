import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { API_TOKENS_FILE } from "../persistence/paths.ts";
import { claimUserByName, deleteUserById, getUserByName } from "../users.ts";
import { _testResetApiTokens, listApiTokens, mintApiToken, resolveApiToken, revokeApiToken } from "./api-tokens.ts";

const USERNAME = "API Token Tester";

beforeEach(reset);
afterEach(reset);

function reset() {
  _testResetApiTokens();
  const existing = getUserByName(USERNAME);
  if (existing) deleteUserById(existing.id);
  try {
    unlinkSync(API_TOKENS_FILE);
  } catch {}
}

describe("personal API tokens", () => {
  test("mints a raw token once and stores only display metadata", async () => {
    const user = claimUserByName(USERNAME, { role: "member", allowedRooms: [] });

    const result = await mintApiToken({ userId: user.id, name: "laptop", expiresInDays: 30, now: 1_000 });

    expect(result.token.startsWith("bureau_pat_")).toBe(true);
    expect(result.apiToken).toMatchObject({
      name: "laptop",
      tokenPrefix: result.token.slice(0, "bureau_pat_".length + 8),
      createdAt: 1_000,
      expiresAt: 1_000 + 30 * 24 * 60 * 60 * 1000,
      lastUsedAt: null,
    });
    expect(listApiTokens(user.id)).toEqual([result.apiToken]);
  });

  test("resolves live tokens to their current user and rejects revoked tokens", async () => {
    const user = claimUserByName(USERNAME, { role: "owner", allowedRooms: [] });
    const result = await mintApiToken({ userId: user.id, name: "script", expiresInDays: null, now: 1_000 });

    expect(resolveApiToken(result.token, 2_000)).toEqual({
      userId: user.id,
      username: USERNAME,
      role: "owner",
      tokenId: result.apiToken.id,
      tokenName: "script",
    });
    expect(await revokeApiToken(user.id, result.apiToken.id)).toBe(true);
    expect(resolveApiToken(result.token, 3_000)).toBeNull();
  });

  test("rejects expired tokens", async () => {
    const user = claimUserByName(USERNAME, { role: "member", allowedRooms: [] });
    const result = await mintApiToken({ userId: user.id, name: "old", expiresInDays: 30, now: 1_000 });

    expect(resolveApiToken(result.token, result.apiToken.expiresAt!)).toBeNull();
  });
});
