import { expect, test } from "bun:test";
import { createModelAvailabilityRunner } from "./runner.ts";

test("a request arriving during a check is captured again after that check finishes", async () => {
  let finish!: (models: { id: string }[]) => void;
  let calls = 0;
  let current = true;
  const results: (string | null)[] = [];
  const run = createModelAvailabilityRunner(
    () => {
      const first = calls++ === 0;
      return [
        {
          id: "agent",
          model: "provider/chosen",
          scope: "account",
          list: () =>
            first
              ? new Promise<{ id: string }[]>((resolve) => {
                  finish = resolve;
                })
              : Promise.resolve([{ id: "provider/chosen" }]),
          current: () => (first ? current : true),
          apply: (model: string | null) => {
            results.push(model);
          },
        },
      ];
    },
    () => {
      throw new Error("Unexpected failure");
    },
  );
  const pending = run("agent");
  current = false;
  const second = run("agent");
  expect(calls).toBe(1);
  finish([{ id: "provider/other" }]);
  await Promise.all([pending, second]);
  expect(calls).toBe(2);
  expect(results).toEqual([null]);
});
