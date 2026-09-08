import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { API_TOKEN_LOGS_DIR, API_TOKENS_FILE } from "../persistence/paths.ts";
import { claimUserByName, deleteUserById, getUserByName } from "../users.ts";
import { _testResetApiTokens, drainApiTokenInbox, enqueueApiTokenInboxMessage, listApiTokens, mintApiToken, resolveApiToken, revokeApiToken, sendApiTokenMessage } from "./api-tokens.ts";
import { tokenLogPath } from "./api-token-log.ts";

const USERNAME = "API Token Tester";

beforeEach(reset);
afterEach(reset);

function reset() {
  _testResetApiTokens();
  const existing = getUserByName(USERNAME);
  if (existing) deleteUserById(existing.id);
  try {
    rmSync(API_TOKENS_FILE, { force: true });
  } catch {}
  try {
    rmSync(API_TOKEN_LOGS_DIR, { recursive: true, force: true });
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

  test("appends sequenced bidirectional log entries and drains by cursor without wiping", async () => {
    const user = claimUserByName(USERNAME, { role: "member", allowedRooms: [] });
    const minted = await mintApiToken({ userId: user.id, name: "phone", expiresInDays: 30 });

    const outbound = await sendApiTokenMessage(minted.apiToken.id, { targetAgentId: "a1", targetAgentName: "Ada", targetRoomName: "Main", text: "please report" }, () => ({ ok: true as const }));
    expect(outbound).toMatchObject({ ok: true });
    if (!outbound.ok) throw new Error("expected send ok");

    const inbound = await enqueueApiTokenInboxMessage({
      tokenId: minted.apiToken.id,
      userId: user.id,
      text: "done",
      senderAgentId: "a1",
      senderAgentName: "Ada",
      senderRoomName: "Main",
      now: 2_000,
    });
    expect(inbound.ok).toBe(true);

    const first = await drainApiTokenInbox(minted.apiToken.id, 3_000, 0);
    expect(first?.entries).toHaveLength(2);
    expect(first?.entries[0]).toMatchObject({ direction: "to_agent", sequence: 1, id: outbound.messageId, text: "please report" });
    expect(first?.entries[1]).toMatchObject({ direction: "from_agent", sequence: 2, text: "done" });
    expect(first?.firstSequence).toBe(1);
    expect(first?.latestSequence).toBe(2);
    expect(first?.previouslyDrainedAt).toBeNull();

    const again = await drainApiTokenInbox(minted.apiToken.id, 4_000, 0);
    expect(again?.entries).toHaveLength(2);
    expect(again?.previouslyDrainedAt).toBe(3_000);

    const after = await drainApiTokenInbox(minted.apiToken.id, 5_000, 2);
    expect(after?.entries).toEqual([]);
    expect(after?.latestSequence).toBe(2);
  });

  test("has no inbox capacity limit", async () => {
    const user = claimUserByName(USERNAME, { role: "member", allowedRooms: [] });
    const minted = await mintApiToken({ userId: user.id, name: "bulk", expiresInDays: 30 });
    for (let i = 0; i < 120; i++) {
      const result = await enqueueApiTokenInboxMessage({
        tokenId: minted.apiToken.id,
        userId: user.id,
        text: `m${i}`,
        senderAgentId: "a1",
        senderAgentName: "Ada",
        senderRoomName: "Main",
      });
      expect(result.ok).toBe(true);
    }
    const drained = await drainApiTokenInbox(minted.apiToken.id, Date.now(), 0);
    expect(drained?.entries).toHaveLength(120);
    expect(drained?.latestSequence).toBe(120);
  });

  test("migrates legacy inbox[] into the JSONL log and strips inbox on reload", async () => {
    const user = claimUserByName(USERNAME, { role: "member", allowedRooms: [] });
    const id = "abcdabcdabcdabcd";
    mkdirSync(API_TOKEN_LOGS_DIR, { recursive: true });
    writeFileSync(
      API_TOKENS_FILE,
      JSON.stringify({
        [id]: {
          id,
          userId: user.id,
          name: "legacy",
          tokenPrefix: "bureau_pat_legacy",
          tokenHash: "a".repeat(64),
          createdAt: 1,
          expiresAt: null,
          lastUsedAt: null,
          lastDrainedAt: null,
          inbox: [
            {
              id: "msg1",
              sentAt: 10,
              text: "old reply",
              senderAgentId: "a1",
              senderAgentName: "Ada",
              senderRoomName: "Main",
            },
          ],
        },
      }),
      "utf-8",
    );

    _testResetApiTokens();
    const drained = await drainApiTokenInbox(id, 100, 0);
    expect(drained?.entries).toHaveLength(1);
    expect(drained?.entries[0]).toMatchObject({
      direction: "from_agent",
      sequence: 1,
      id: "msg1",
      text: "old reply",
    });
    expect(existsSync(tokenLogPath(id))).toBe(true);
    const stored = JSON.parse(readFileSync(API_TOKENS_FILE, "utf-8")) as Record<string, { inbox?: unknown; lastSequence: number }>;
    expect(stored[id]?.inbox).toBeUndefined();
    expect(stored[id]?.lastSequence).toBe(1);
  });
});
