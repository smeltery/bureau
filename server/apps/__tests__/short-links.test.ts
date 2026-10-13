import { expect, test } from "bun:test";
import type { AppRecord } from "../../../shared/apps.ts";
import { appShortUrl } from "../short-links.ts";
import { shortAppName, appChatStatus } from "../chat-page.ts";
import type { SessionLookup } from "../../auth/auth.ts";

const app = { name: "board", hostLabel: "board-g2", hostGen: 2, userId: "alice" } as AppRecord;
const publicUrl = "https://board-g2.apps.example/";
const owner = { userId: "owner", role: "owner", sessionIdHash: "office-session" } as SessionLookup;

test("short addresses name the office app shell and preserve the app generation", () => {
  expect(appShortUrl(app, publicUrl, "https://office.example")).toBe("https://office.example/board");
  expect(shortAppName("/board/")).toBe("board");
  expect(appChatStatus(app, owner, publicUrl)).toEqual({ name: "board", hostGen: 2, appUrl: publicUrl, agentId: null, sessionExpiresAt: null });
});

test("reserved paths and inaccessible, archived or unhosted apps are refused", () => {
  for (const name of ["tasks", "skills", "settings", "pager", "chat", "schedules", "api"]) {
    expect(shortAppName(`/${name}`)).toBeNull();
    expect(appShortUrl({ ...app, name }, publicUrl, "https://office.example")).toBeUndefined();
  }
  for (const path of ["/board/path", "/%62oard"]) expect(shortAppName(path)).toBeNull();
  expect(appChatStatus(app, { ...owner, role: "member", userId: "bob" }, publicUrl)).toBeNull();
  expect(appChatStatus({ ...app, archivedAt: 1 }, owner, publicUrl)).toBeNull();
  expect(appChatStatus(app, owner, null)).toBeNull();
  expect(appShortUrl(app, null, "https://office.example")).toBeUndefined();
  expect(appShortUrl({ ...app, archivedAt: 1 }, publicUrl, "https://office.example")).toBeUndefined();
});
