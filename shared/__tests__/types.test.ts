import { describe, expect, test } from "bun:test";
import {
  cronjobRunStreamId,
  familyDisplayLabel,
  familyFromLegacyModel,
  generateCronjobId,
  generateCronjobRunId,
  generateRoomId,
  generateTaskId,
  humanizeSchedule,
  injectedMemorySize,
  isValidPriority,
  isValidStatus,
  modelVersionLabel,
  parseStreamId,
} from "../types.ts";

describe("hex ID generators", () => {
  test("each generator returns an 8-char hex string", () => {
    for (const gen of [generateTaskId, generateCronjobId, generateCronjobRunId, generateRoomId]) {
      const id = gen();
      expect(id).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  test("avoids collisions with the supplied existing list", () => {
    // Pre-fill the seen set with every value the next 4 random bytes might
    // collide with by generating a few candidates and asserting they're not
    // in the existing list passed in.
    const taken = new Set<string>();
    for (let i = 0; i < 50; i++) taken.add(generateCronjobId([...taken]));
    expect(taken.size).toBe(50);
  });
});

describe("injectedMemorySize", () => {
  test("counts the prompt contribution after blank lines are removed", () => {
    expect(injectedMemorySize("\nfirst\n\n  \nsecond\n")).toBe("first\nsecond".length);
  });
});

describe("cronjob run stream IDs", () => {
  test("cronjobRunStreamId prefixes with 'cronrun-'", () => {
    expect(cronjobRunStreamId("abc12345")).toBe("cronrun-abc12345");
  });

  test("parseStreamId routes 'cronrun-…' to the cronjob_run kind", () => {
    expect(parseStreamId("cronrun-deadbeef")).toEqual({
      kind: "cronjob_run",
      runId: "deadbeef",
    });
  });

  test("parseStreamId routes anything else to the agent kind", () => {
    expect(parseStreamId("agent-1234567890-abcd")).toEqual({
      kind: "agent",
      agentId: "agent-1234567890-abcd",
    });
  });

  test("round-trips via cronjobRunStreamId", () => {
    const runId = "12345678";
    const streamId = cronjobRunStreamId(runId);
    const parsed = parseStreamId(streamId);
    expect(parsed.kind).toBe("cronjob_run");
    if (parsed.kind === "cronjob_run") expect(parsed.runId).toBe(runId);
  });
});

describe("humanizeSchedule", () => {
  test("daily produces zero-padded HH:MM", () => {
    expect(humanizeSchedule({ type: "daily", hour: 9, minute: 5 })).toBe("Daily at 09:05");
  });

  test("weekly includes weekday abbreviation", () => {
    expect(humanizeSchedule({ type: "weekly", weekday: 1, hour: 14, minute: 30 })).toBe("Weekly Mon at 14:30");
    expect(humanizeSchedule({ type: "weekly", weekday: 0, hour: 0, minute: 0 })).toBe("Weekly Sun at 00:00");
  });

  test("interval renders minutes for sub-hour values", () => {
    expect(humanizeSchedule({ type: "interval", minutes: 5 })).toBe("Every 5m");
    expect(humanizeSchedule({ type: "interval", minutes: 45 })).toBe("Every 45m");
  });

  test("interval renders whole-hour values with the h suffix", () => {
    expect(humanizeSchedule({ type: "interval", minutes: 60 })).toBe("Every 1h");
    expect(humanizeSchedule({ type: "interval", minutes: 180 })).toBe("Every 3h");
  });

  test("interval renders mixed hour+minute values", () => {
    expect(humanizeSchedule({ type: "interval", minutes: 90 })).toBe("Every 1h30m");
  });
});

describe("model family helpers", () => {
  test("modelVersionLabel extracts X.Y or a single trailing number from the model slug", () => {
    expect(modelVersionLabel("opus")).toBe("5.5");
    expect(modelVersionLabel("sonnet")).toBe("5.5");
  });

  test("modelVersionLabel falls back to a single trailing number (e.g. Fable)", () => {
    expect(modelVersionLabel("fable")).toBe("5.1");
  });

  test("familyDisplayLabel formats as '<Family> <X.Y>'", () => {
    expect(familyDisplayLabel("opus")).toBe("Opus 5.5");
    expect(familyDisplayLabel("sonnet")).toBe("Sonnet 5.5");
    expect(familyDisplayLabel("fable")).toBe("Fable 5.1");
  });

  test("familyFromLegacyModel recognises substrings", () => {
    expect(familyFromLegacyModel("claude-opus-4-6")).toBe("opus");
    expect(familyFromLegacyModel("claude-sonnet-4-2")).toBe("sonnet");
    expect(familyFromLegacyModel("claude-haiku-4-1")).toBe("haiku");
    expect(familyFromLegacyModel("claude-fable-5")).toBe("fable");
  });

  test("familyFromLegacyModel falls back to opus for unknown / undefined input", () => {
    expect(familyFromLegacyModel(undefined)).toBe("opus");
    expect(familyFromLegacyModel("")).toBe("opus");
    expect(familyFromLegacyModel("gpt-4")).toBe("opus");
  });
});

describe("task validators", () => {
  test("isValidStatus accepts only the three known statuses", () => {
    expect(isValidStatus("open")).toBe(true);
    expect(isValidStatus("in_progress")).toBe(true);
    expect(isValidStatus("done")).toBe(true);
    expect(isValidStatus("closed")).toBe(false);
    expect(isValidStatus(undefined)).toBe(false);
    expect(isValidStatus(7)).toBe(false);
  });

  test("isValidPriority accepts P0..P3 and rejects everything else", () => {
    for (const p of ["P0", "P1", "P2", "P3"]) expect(isValidPriority(p)).toBe(true);
    expect(isValidPriority("P4")).toBe(false);
    expect(isValidPriority("p0")).toBe(false);
    expect(isValidPriority(null)).toBe(false);
  });
});
