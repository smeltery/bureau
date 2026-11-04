import { expect, test } from "bun:test";
import { questionExcerpt, withDiscussPrefix } from "./discuss.ts";

test("the excerpt keeps short prompts whole and cuts long ones at a word", () => {
  expect(questionExcerpt("  Ship the\nhotfix tonight?  ")).toBe("Ship the hotfix tonight?");
  expect(questionExcerpt("Should we rename the staging bucket before the release next week?")).toBe("Should we rename the staging bucket…");
  // A single long word gets a hard cut rather than an empty excerpt.
  expect(questionExcerpt("x".repeat(60))).toBe(`${"x".repeat(40)}…`);
});

test("the prefix goes in front of the draft once", () => {
  const prefix = 'About your question "Ship it?": ';
  expect(withDiscussPrefix("", prefix)).toBe(prefix);
  expect(withDiscussPrefix("half-written note", prefix)).toBe(`${prefix}half-written note`);
  expect(withDiscussPrefix(`${prefix}already there`, prefix)).toBe(`${prefix}already there`);
});
