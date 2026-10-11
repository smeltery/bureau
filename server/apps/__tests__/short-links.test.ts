import { expect, test } from "bun:test";
import type { AppRecord } from "../../../shared/apps.ts";
import { appShortRedirect, appShortUrl } from "../short-links.ts";

const app = { name: "board", hostLabel: "board-g2" } as AppRecord;
const publicUrl = "https://board-g2.apps.example/";

test("short addresses keep queries and redirect to the issued origin", () => {
  expect(appShortUrl(app, publicUrl, "https://office.example")).toBe("https://office.example/board");
  for (const method of ["GET", "HEAD"]) {
    const response = appShortRedirect(
      new Request("https://untrusted.example/board/?tab=2", { method }),
      () => app,
      () => publicUrl,
    )!;
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${publicUrl}?tab=2`);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
});

test("office routes, archived apps and offices without app domains keep their routing", () => {
  for (const name of ["tasks", "skills", "settings", "pager", "chat", "schedules", "api"]) {
    expect(appShortUrl({ ...app, name }, publicUrl, "https://office.example")).toBeUndefined();
    expect(
      appShortRedirect(
        new Request(`https://office.example/${name}`),
        () => ({ ...app, name }),
        () => publicUrl,
      ),
    ).toBeNull();
  }
  expect(appShortUrl(app, null, "https://office.example")).toBeUndefined();
  expect(appShortUrl({ ...app, archivedAt: 1 }, publicUrl, "https://office.example")).toBeUndefined();
  for (const path of ["/board/path", "/%62oard"])
    expect(
      appShortRedirect(
        new Request(`https://office.example${path}`),
        () => app,
        () => publicUrl,
      ),
    ).toBeNull();
  expect(
    appShortRedirect(
      new Request("https://office.example/board", { method: "POST" }),
      () => app,
      () => publicUrl,
    ),
  ).toBeNull();
});
