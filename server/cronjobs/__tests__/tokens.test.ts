import { afterEach, describe, expect, test } from "bun:test";
import { _testResetRunTokens, getRunToken, mintRunToken, resolveRunToken, revokeRunToken } from "../tokens.ts";

afterEach(() => {
  _testResetRunTokens();
});

describe("cron run bearer tokens", () => {
  test("minted tokens resolve to their run and user", () => {
    const raw = mintRunToken("cron-1", "run-1", "user-1");

    expect(getRunToken("run-1")).toBe(raw);
    expect(resolveRunToken(raw)).toEqual({ cronjobId: "cron-1", runId: "run-1", userId: "user-1" });
  });

  test("minting rotates the previous token", () => {
    const first = mintRunToken("cron-1", "run-1", "user-1");
    const second = mintRunToken("cron-1", "run-1", "user-1");

    expect(second).not.toBe(first);
    expect(resolveRunToken(first)).toBeNull();
    expect(resolveRunToken(second)).toEqual({ cronjobId: "cron-1", runId: "run-1", userId: "user-1" });
  });

  test("revoking removes a token", () => {
    const raw = mintRunToken("cron-1", "run-1", null);

    revokeRunToken("run-1");

    expect(getRunToken("run-1")).toBeNull();
    expect(resolveRunToken(raw)).toBeNull();
  });
});
