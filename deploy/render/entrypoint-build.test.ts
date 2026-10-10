import { expect, test } from "bun:test";

test("the Render entrypoint resolves its production imports", async () => {
  const result = await Bun.build({
    entrypoints: [new URL("./office.ts", import.meta.url).pathname],
    target: "bun",
    write: false,
    external: ["playwright-core"],
  });
  expect(result.logs.filter((entry) => entry.level === "error")).toEqual([]);
  expect(result.success).toBe(true);
});
