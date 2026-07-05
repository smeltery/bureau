import { describe, expect, test } from "bun:test";
import { handleCronjobsRequest } from "../cronjobs.ts";

describe("handleCronjobsRequest", () => {
  test("accepts /api/cronjobs as an alias for cronjob reads", async () => {
    const req = new Request("http://local.test/api/cronjobs");

    const res = await handleCronjobsRequest(req, new URL(req.url));

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual([]);
  });

  test("returns aggregate runs from /api/cron-runs", async () => {
    const req = new Request("http://local.test/api/cron-runs");

    const res = await handleCronjobsRequest(req, new URL(req.url));

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ jobs: [] });
  });

  test("routes /api cron run affordances through the cron handler", async () => {
    const req = new Request("http://local.test/api/cronjobs/cron-1/runs/run-1/diff", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await handleCronjobsRequest(req, new URL(req.url));

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "not found" });
  });
});
