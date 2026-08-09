// Slide sidecar store tests. Every case runs against an injected temp directory,
// so nothing here can reach the real state root. Zero LLM.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readDeck, readSlide, writeSlide, SLIDES_DIR } from "../store.ts";
import type { SlideRecord } from "../../../shared/slides.ts";

function record(overrides: Partial<SlideRecord> = {}): SlideRecord {
  return {
    html: "<div>slide</div>",
    placeholder: false,
    errorText: null,
    promptText: "What is 2+2?",
    model: "sonnet",
    createdAt: 1,
    contentDigest: "deadbeefdeadbeef",
    ...overrides,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bureau-slides-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("slide store", () => {
  it("lives under the state root by default (never the log tree)", () => {
    expect(SLIDES_DIR.endsWith(join("state", "slides"))).toBe(true);
  });

  it("returns an empty deck for a conversation that has none", () => {
    expect(readDeck("a1", "root1", dir)).toEqual({});
    expect(readSlide("a1", "root1", "u1", dir)).toBeNull();
  });

  it("writes one slide per turn and reads it back, keyed by entry id", () => {
    writeSlide("a1", "root1", "u1", record({ html: "<div>one</div>" }), dir);
    writeSlide("a1", "root1", "u2", record({ html: "<div>two</div>" }), dir);
    expect(readSlide("a1", "root1", "u1", dir)?.html).toBe("<div>one</div>");
    expect(readSlide("a1", "root1", "u2", dir)?.html).toBe("<div>two</div>");
    expect(Object.keys(readDeck("a1", "root1", dir)).sort()).toEqual(["u1", "u2"]);
  });

  it("creates the per-agent directory and stores one file per conversation", () => {
    writeSlide("a1", "root1", "u1", record(), dir);
    const path = join(dir, "a1", "root1.json");
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toHaveProperty("slides.u1");
  });

  it("regeneration overwrites in place", () => {
    writeSlide("a1", "root1", "u1", record({ html: "<div>old</div>" }), dir);
    writeSlide("a1", "root1", "u1", record({ html: "<div>new</div>" }), dir);
    const deck = readDeck("a1", "root1", dir);
    expect(Object.keys(deck)).toEqual(["u1"]);
    expect(deck.u1.html).toBe("<div>new</div>");
  });

  it("keeps decks separate per conversation and per agent", () => {
    writeSlide("a1", "root1", "u1", record({ html: "<div>a1/root1</div>" }), dir);
    writeSlide("a1", "root2", "u1", record({ html: "<div>a1/root2</div>" }), dir);
    writeSlide("a2", "root1", "u1", record({ html: "<div>a2/root1</div>" }), dir);
    expect(readSlide("a1", "root1", "u1", dir)?.html).toBe("<div>a1/root1</div>");
    expect(readSlide("a1", "root2", "u1", dir)?.html).toBe("<div>a1/root2</div>");
    expect(readSlide("a2", "root1", "u1", dir)?.html).toBe("<div>a2/root1</div>");
  });

  it("reads never throw: a corrupt file yields an empty deck", () => {
    mkdirSync(join(dir, "a1"), { recursive: true });
    writeFileSync(join(dir, "a1", "root1.json"), "{not json");
    expect(readDeck("a1", "root1", dir)).toEqual({});
    expect(readSlide("a1", "root1", "u1", dir)).toBeNull();
  });

  it("reads never throw: a file with no slides map yields an empty deck", () => {
    mkdirSync(join(dir, "a1"), { recursive: true });
    writeFileSync(join(dir, "a1", "root1.json"), JSON.stringify({ slides: "nope" }));
    expect(readDeck("a1", "root1", dir)).toEqual({});
  });

  it("a write into a corrupt deck recovers rather than failing (the file is replaced)", () => {
    mkdirSync(join(dir, "a1"), { recursive: true });
    writeFileSync(join(dir, "a1", "root1.json"), "{not json");
    writeSlide("a1", "root1", "u1", record(), dir);
    expect(Object.keys(readDeck("a1", "root1", dir))).toEqual(["u1"]);
  });
});
