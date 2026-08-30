import { describe, expect, it } from "bun:test";
import type { AppRecord } from "../../../shared/apps.ts";
import { APP_PREVIEW_CACHE_TTL_MS, createAppPreviewCapture } from "../preview.ts";

const app: AppRecord = {
  name: "hello",
  hostLabel: "hello",
  hostGen: 1,
  port: 21000,
  command: "bun run start",
  cwd: "/tmp",
  dataDir: "/tmp/hello",
  userId: "u1",
  username: "Boss",
  createdBy: "Agent",
  createdAt: 1,
};

describe("app preview capture", () => {
  it("captures loopback at the card viewport, caches, and expires on demand", async () => {
    let now = 1_000;
    const calls: unknown[] = [];
    const previews = createAppPreviewCapture(
      async (body: unknown) => {
        calls.push(body);
        return { ok: true, png: Buffer.from(`png-${calls.length}`), caption: "hello", filename: "hello.png" };
      },
      () => now,
    );

    expect((await previews.capture(app)).ok).toBe(true);
    expect((await previews.capture(app)).ok).toBe(true);
    expect(calls).toEqual([{ url: "http://127.0.0.1:21000/", viewport: { width: 800, height: 500 }, wait: 0 }]);

    now += APP_PREVIEW_CACHE_TTL_MS;
    await previews.capture(app);
    expect(calls).toHaveLength(2);
  });
});
