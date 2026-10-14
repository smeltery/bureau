import { expect, test } from "bun:test";
import { changedPromptSnapshots } from "./prompt-snapshots.ts";

test("prompt history records text changes and clears without unrelated values", () => {
  const before = JSON.stringify({ prompt: "Old", envFile: "/private" });
  const after = JSON.stringify({ prompt: "New", credential: "private-value" });
  expect(changedPromptSnapshots("office-config.json", before, after)).toEqual([{ scope: "office", id: "office", text: "New" }]);
  expect(changedPromptSnapshots("office-config.json", after, '{"prompt":null}')).toEqual([{ scope: "office", id: "office", text: "" }]);
  expect(changedPromptSnapshots("office-config.json", after, after)).toEqual([]);
  expect(changedPromptSnapshots("credentials.json", null, after)).toEqual([]);
  expect(changedPromptSnapshots("office-config.json", before, "invalid")).toEqual([]);
});

test("room, agent and member snapshots keep stable identities across reordering", () => {
  const before = [
    { id: "r1", prompt: "Room", agents: [{ id: "a1", customInstructions: "Agent" }] },
    { id: "r2", agents: [] },
  ];
  const after = [
    { id: "r2", agents: [{ id: "a1", customInstructions: "Changed" }] },
    { id: "r1", prompt: "Room", agents: [] },
  ];
  expect(changedPromptSnapshots("agents.json", JSON.stringify(before), JSON.stringify(after))).toEqual([{ scope: "agent", id: "a1", text: "Changed" }]);
  expect(changedPromptSnapshots("users.json", JSON.stringify([{ id: "u", memberPrompt: "Before" }]), JSON.stringify([{ id: "u", memberPrompt: "After", envFile: "private" }]))).toEqual([
    { scope: "member", id: "u", text: "After" },
  ]);
});
