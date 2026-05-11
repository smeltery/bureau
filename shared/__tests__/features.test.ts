import { describe, expect, test } from "bun:test";
import { DEMO_FEATURES, PRODUCTION_FEATURES, type Features } from "../features.ts";

describe("PRODUCTION_FEATURES", () => {
  test("enables sessions, terminal, editor and live LLM", () => {
    expect(PRODUCTION_FEATURES.sessions).toBe(true);
    expect(PRODUCTION_FEATURES.terminal).toBe(true);
    expect(PRODUCTION_FEATURES.editor).toBe(true);
    expect(PRODUCTION_FEATURES.llmConnected).toBe(true);
  });

  test("does not embed (no marketing-page chrome stripping)", () => {
    expect(PRODUCTION_FEATURES.embed).toBe(false);
  });
});

describe("DEMO_FEATURES", () => {
  test("disables session-related features (no resume/new conversation in the marketing demo)", () => {
    expect(DEMO_FEATURES.sessions).toBe(false);
  });

  test("disables the terminal panel", () => {
    expect(DEMO_FEATURES.terminal).toBe(false);
  });

  test("disables the file editor side panel", () => {
    expect(DEMO_FEATURES.editor).toBe(false);
  });

  test("runs without an LLM (fake responses)", () => {
    expect(DEMO_FEATURES.llmConnected).toBe(false);
  });

  test("does not embed by default (the embed page sets it explicitly)", () => {
    expect(DEMO_FEATURES.embed).toBe(false);
  });
});

describe("Features shape", () => {
  test("PRODUCTION_FEATURES and DEMO_FEATURES have the same set of keys", () => {
    expect(Object.keys(PRODUCTION_FEATURES).sort()).toEqual(Object.keys(DEMO_FEATURES).sort());
  });

  test("every flag is a boolean", () => {
    for (const value of Object.values(PRODUCTION_FEATURES)) expect(typeof value).toBe("boolean");
    for (const value of Object.values(DEMO_FEATURES)) expect(typeof value).toBe("boolean");
  });

  test("the constants are assignable to the Features type (compile-time guard)", () => {
    const _prod: Features = PRODUCTION_FEATURES;
    const _demo: Features = DEMO_FEATURES;
    expect(_prod).toBeDefined();
    expect(_demo).toBeDefined();
  });
});
