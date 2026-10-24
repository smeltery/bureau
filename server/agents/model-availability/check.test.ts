import { expect, test } from "bun:test";
import { checkModelAvailability, modelAvailability, type ModelCheckTarget } from "./check.ts";

const listed = (...ids: string[]) => ids.map((id) => ({ id }));

test("a disconnected provider or a similarly named provider cannot prove model removal", () => {
  const models = listed("provider/kept", "provider-extra/removed");
  expect(modelAvailability("provider/kept", models)).toBe("available");
  expect(modelAvailability("provider/removed", models)).toBe("missing");
  expect(modelAvailability("other/removed", models)).toBe("unknown");
  expect(modelAvailability("provider", models)).toBe("unknown");
  expect(modelAvailability("provider/removed", [])).toBe("unknown");
  expect(modelAvailability("provider/removed", null)).toBe("unknown");
});

test("checks share only the captured environment and do not start environments concurrently", async () => {
  const calls: string[] = [];
  let running = 0;
  let maximum = 0;
  const target = (id: string, scope: string): ModelCheckTarget => ({
    id,
    scope,
    model: "provider/chosen",
    async list() {
      calls.push(scope);
      maximum = Math.max(maximum, ++running);
      await Bun.sleep(1);
      running--;
      return listed(scope === "account-a/room-a/project" ? "provider/chosen" : "provider/other");
    },
  });
  const result = await checkModelAvailability([
    target("a", "account-a/room-a/project"),
    target("b", "account-a/room-a/project"),
    target("c", "account-b/room-a/project"),
    target("d", "account-a/room-b/project"),
    target("e", "account-a/room-a/other"),
  ]);
  expect(calls).toHaveLength(4);
  expect(maximum).toBe(1);
  expect(Object.fromEntries(result)).toEqual({ a: "available", b: "available", c: "missing", d: "missing", e: "missing" });
});

test("failures and a stalled lookup stay unknown while subsequent environments are checked", async () => {
  let finish!: (models: { id: string }[]) => void;
  const pending = new Promise<{ id: string }[]>((resolve) => {
    finish = resolve;
  });
  const result = await checkModelAvailability(
    [
      {
        id: "offline",
        scope: "offline",
        model: "provider/chosen",
        list: async () => {
          throw new Error("Offline");
        },
      },
      { id: "stalled", scope: "stalled", model: "provider/chosen", list: () => pending },
      { id: "working", scope: "working", model: "provider/chosen", list: async () => listed("provider/other") },
    ],
    10,
  );
  expect(Object.fromEntries(result)).toEqual({ offline: "unknown", stalled: "unknown", working: "missing" });
  finish(listed("provider/chosen"));
  await pending;
  expect(result.get("stalled")).toBe("unknown");
});
