import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("Render entrypoint and office agree on container supervisor selection", () => {
  const entrypoint = readFileSync(new URL("./entrypoint.sh", import.meta.url), "utf8");
  const supervisor = readFileSync(new URL("../../server/apps/supervisor.ts", import.meta.url), "utf8");
  expect(entrypoint).toContain("export BUREAU_APP_SUPERVISOR=container\n");
  expect(supervisor).toContain('process.env.BUREAU_APP_SUPERVISOR === "container"');
});
