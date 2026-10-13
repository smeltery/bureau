import { expect, test } from "bun:test";
import { appChatDraftKey, appSignInUrl, beginAppSignIn, isAppSessionSignal } from "./chat-state.ts";

test("drafts separate app generations, users and assigned agents", () => {
  const boot = { name: "board", hostGen: 1 };
  const keys = [appChatDraftKey(boot, "alice", "a"), appChatDraftKey({ ...boot, hostGen: 2 }, "alice", "a"), appChatDraftKey(boot, "bob", "a"), appChatDraftKey(boot, "alice", "b")];
  expect(new Set(keys).size).toBe(4);
});

test("sign-in is bounded and signals must come from the actual app frame", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const boot = { name: "board", hostGen: 2 };
  expect(beginAppSignIn(storage, boot, 1000)).toBe(true);
  expect(beginAppSignIn(storage, boot, 2000)).toBe(false);
  expect(beginAppSignIn(storage, boot, 62000)).toBe(true);
  const frame = {} as Window;
  const event = { source: frame, origin: "https://board-g2.example", data: "bureau:app-session-required" };
  expect(isAppSessionSignal(event, frame, event.origin)).toBe(true);
  expect(isAppSessionSignal({ ...event, origin: "https://evil.example" }, frame, event.origin)).toBe(false);
  expect(isAppSessionSignal(event, {} as Window, event.origin)).toBe(false);
  const url = new URL(appSignInUrl(`${event.origin}/`, "?tab=2"), "https://office.example");
  expect(url.searchParams.get("app")).toBe("board-g2");
  expect(url.searchParams.get("r")).toBe("/?tab=2");
});
