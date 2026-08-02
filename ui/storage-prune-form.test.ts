import { describe, expect, test } from "bun:test";
import type { PrunePlanWire } from "../shared/storage-types.ts";
import { applyRequest, planMatchesForm, previewRequest, type PolicyForm } from "./storage-prune-form.ts";

const form = (overrides: Partial<PolicyForm> = {}): PolicyForm => ({
  target: "transcripts",
  olderThanDays: "90",
  keepPerAgent: "5",
  ...overrides,
});

const planFor = (overrides: Partial<PrunePlanWire> = {}): PrunePlanWire => ({
  target: "transcripts",
  policy: { olderThanDays: 90, keepPerAgent: 5 },
  candidates: [],
  bytes: 0,
  skipped: [],
  ...overrides,
});

describe("previewRequest", () => {
  test("builds a dry-run transcript request", () => {
    expect(previewRequest(form())).toEqual({ target: "transcripts", olderThanDays: 90, keepPerAgent: 5 });
  });

  test("keeps explicit zero for transcript retention", () => {
    expect(previewRequest(form({ keepPerAgent: "0" }))).toEqual({ target: "transcripts", olderThanDays: 90, keepPerAgent: 0 });
  });

  test("omits keepPerAgent for attachment requests", () => {
    expect(previewRequest(form({ target: "attachments", keepPerAgent: "bad" }))).toEqual({ target: "attachments", olderThanDays: 90 });
  });

  test("rejects empty, too-small, and non-integer inputs", () => {
    expect(previewRequest(form({ olderThanDays: "" }))).toBeNull();
    expect(previewRequest(form({ olderThanDays: "0" }))).toBeNull();
    expect(previewRequest(form({ olderThanDays: "1.5" }))).toBeNull();
    expect(previewRequest(form({ keepPerAgent: "" }))).toBeNull();
    expect(previewRequest(form({ keepPerAgent: "-1" }))).toBeNull();
  });
});

describe("applyRequest", () => {
  test("derives transcript apply bodies from the previewed plan", () => {
    expect(applyRequest(planFor({ policy: { olderThanDays: 365, keepPerAgent: 0 } }))).toEqual({
      target: "transcripts",
      olderThanDays: 365,
      keepPerAgent: 0,
      apply: true,
    });
  });

  test("omits keepPerAgent for attachment apply bodies", () => {
    expect(applyRequest(planFor({ target: "attachments", policy: { olderThanDays: 30, keepPerAgent: 0 } }))).toEqual({
      target: "attachments",
      olderThanDays: 30,
      apply: true,
    });
  });
});

describe("planMatchesForm", () => {
  test("accepts a plan that still matches the form", () => {
    expect(planMatchesForm(planFor(), form())).toBe(true);
  });

  test("rejects stale plans after target, age, or keep changes", () => {
    expect(planMatchesForm(planFor(), form({ target: "attachments" }))).toBe(false);
    expect(planMatchesForm(planFor(), form({ olderThanDays: "30" }))).toBe(false);
    expect(planMatchesForm(planFor(), form({ keepPerAgent: "2" }))).toBe(false);
  });

  test("ignores keepPerAgent for attachment plans", () => {
    const plan = planFor({ target: "attachments", policy: { olderThanDays: 90, keepPerAgent: 0 } });
    expect(planMatchesForm(plan, form({ target: "attachments", keepPerAgent: "bad" }))).toBe(true);
  });
});
