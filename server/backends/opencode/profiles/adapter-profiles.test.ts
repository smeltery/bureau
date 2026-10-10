import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenCodeBackend } from "../adapter.ts";
import { OpenCodeProfiles } from "./registry.ts";
import { OpenCodeProfileStore } from "./store.ts";
import { openCodeEnvironmentId } from "./identity.ts";
import type { OpenCodeSupervisor } from "../supervisor.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
});

test("create, restart, history, resume and fork keep the durable session profile", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-opencode-binding-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const visits: { profile: string; path: string }[] = [];
  const factory = (profileDir: string) => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        visits.push({ profile: profileDir, path });
        if (path === "/session") return Response.json({ id: "created-session" });
        if (path.endsWith("/fork")) return Response.json({ id: "forked-session" });
        if (path.endsWith("/message")) return Response.json([{ info: { id: "message-1", role: "user" }, parts: [{ type: "text", text: "retained history" }] }]);
        if (path === "/provider") return Response.json({ connected: [], all: [] });
        if (path === "/event") return new Response("", { headers: { "content-type": "text/event-stream" } });
        return new Response(null, { status: 204 });
      },
    });
    cleanup.push(() => server.stop(true));
    return {
      profileDir,
      acquire: async () => ({ baseUrl: `http://127.0.0.1:${server.port}`, authHeader: "", pid: 1, release() {}, beginTurn: async () => {}, endTurn() {}, recoverBeforePrompt: async () => {} }),
    } as unknown as OpenCodeSupervisor;
  };
  const boot = () => createOpenCodeBackend({ profiles: new OpenCodeProfiles(new OpenCodeProfileStore(root), factory) });
  const opts = {
    agentId: "agent-test",
    cwd: "/work",
    modelFamily: "provider/model",
    systemPrompt: "test",
    permissionMode: "default",
    effort: "high",
    environmentId: openCodeEnvironmentId("alice", "room-a"),
    env: { OPENCODE_API_KEY: "initial" },
  };
  const initial = boot().createSession(opts);
  await initial.send("hello");
  initial.close();
  const original = new OpenCodeProfileStore(root).read("created-session")!;
  expect(original.profile).not.toBe("default");
  const restarted = boot();
  const access = { ...opts, env: { OPENCODE_API_KEY: "rotated" } };
  const history = await restarted.getSessionMessages("created-session", opts.cwd, access);
  expect(history[0]?.text).toBe("retained history");
  const resumed = restarted.resumeSession("created-session", access);
  await resumed.send("continue");
  resumed.close();
  expect(await restarted.forkSessionBeforeMessage("created-session", "message-1", access)).toMatchObject({ kind: "fork", sessionId: "forked-session" });
  expect(new OpenCodeProfileStore(root).read("forked-session")?.profile).toBe(original.profile);
  expect(new Set(visits.map(({ profile }) => profile))).toEqual(new Set([join(root, "profiles", original.profile)]));
  await expect(restarted.getSessionMessages("created-session", opts.cwd, { ...access, environmentId: openCodeEnvironmentId("bob", "room-a") })).rejects.toThrow("another manager or room");
});
