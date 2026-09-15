import { describe, expect, test } from "bun:test";
import { pageForPath, pathForPage, type Page } from "./routes.ts";

const PAGES: Page[] = ["tasks", "schedules", "apps", "plugins", "settings", "team-chat"];

describe("pageForPath", () => {
  test("maps each canonical panel path", () => {
    for (const page of PAGES) expect(pageForPath(`/${page}`)).toBe(page);
  });

  test("office paths are null", () => {
    expect(pageForPath("/")).toBeNull();
    expect(pageForPath("")).toBeNull();
  });

  test("forgives trailing slashes", () => {
    expect(pageForPath("/tasks/")).toBe("tasks");
    expect(pageForPath("/settings//")).toBe("settings");
    expect(pageForPath("/team-chat/")).toBe("team-chat");
  });

  test("accepts legacy aliases without producing them", () => {
    expect(pageForPath("/cronjobs")).toBe("schedules");
    expect(pageForPath("/users")).toBe("settings");
    expect(pageForPath("/chat")).toBe("team-chat");
    expect(pathForPage("schedules")).toBe("/schedules");
    expect(pathForPage("settings")).toBe("/settings");
    expect(pathForPage("team-chat")).toBe("/team-chat");
  });

  test("rejects case variants and non-routes", () => {
    expect(pageForPath("/Tasks")).toBeNull();
    expect(pageForPath("tasks")).toBeNull();
    expect(pageForPath("//tasks")).toBeNull();
    expect(pageForPath("/garbage")).toBeNull();
    expect(pageForPath("/tasks/extra")).toBeNull();
  });
});

describe("pathForPage", () => {
  test("round-trips canonical pages", () => {
    expect(pathForPage(null)).toBe("/");
    for (const page of PAGES) {
      expect(pathForPage(page)).toBe(`/${page}`);
      expect(pageForPath(pathForPage(page))).toBe(page);
    }
  });
});
