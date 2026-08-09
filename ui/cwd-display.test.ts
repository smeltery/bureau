import { describe, expect, test } from "bun:test";
import { shortenCwd } from "./cwd-display.ts";

describe("shortenCwd", () => {
  test("abbreviates a home-rooted path to ~", () => {
    expect(shortenCwd("/home/nick/dev/bureau")).toBe("~/dev/bureau");
  });

  test("abbreviates the bare home dir", () => {
    expect(shortenCwd("/home/nick")).toBe("~");
  });

  test("leaves non-home paths untouched", () => {
    expect(shortenCwd("/srv/deploys/bureau")).toBe("/srv/deploys/bureau");
    expect(shortenCwd("/homework/nick")).toBe("/homework/nick");
  });

  test("only shortens at the start of the path", () => {
    expect(shortenCwd("/srv/home/nick")).toBe("/srv/home/nick");
  });
});
