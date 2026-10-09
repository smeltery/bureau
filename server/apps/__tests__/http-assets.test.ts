import * as AgentManager from "../../agent-manager.ts";
import { handleAppAssetsRequest } from "../http-assets.ts";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAppRegistry } from "../registry.ts";
import { deleteThumbnail, readThumbnail, validateThumbnail } from "../thumbnails.ts";
import { handleAppsRequest } from "../../http/apps.ts";
import { defaultAppsDeps } from "../../http/apps-deps.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import type { AppRecord } from "../../../shared/apps.ts";

const dirs: string[] = [];
const records: AppRecord[] = [];
afterEach(() => {
  for (const app of records.splice(0)) deleteThumbnail(app);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const owner: AuthResult = {
  kind: "ok",
  session: { userId: "owner", username: "Owner", role: "owner", sessionIdHash: "h", sessionPrefix: "p", needsRolling: false, absoluteExpiresAt: Date.now() + 60_000 },
};
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64");

test("archive stops and revokes before persisting, reserves identity, and restores the same data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bureau-archive-"));
  dirs.push(dir);
  const registry = createAppRegistry({ dir, probePort: () => true });
  const app = registry.register({ name: "archive-test", command: "bun app.ts", cwd: dir, userId: "owner", username: "Owner", createdBy: "Owner" });
  records.push(app);
  writeFileSync(join(app.dataDir, "state.txt"), "keep me");
  const calls: string[] = [];
  const deps = {
    ...defaultAppsDeps,
    registry,
    publicUrl: () => null,
    states: () => new Map(),
    teardown: () => {
      calls.push("teardown");
    },
    revokeToken: () => {
      calls.push("revoke");
    },
    install: () => {
      calls.push("install");
    },
    provisionToken: () => {
      calls.push("token");
      return true;
    },
  };
  const call = async (verb: string) => {
    const req = new Request(`http://local/api/apps/${app.name}/${verb}`, { method: "POST" });
    return (await handleAppsRequest(req, new URL(req.url), owner, deps))!;
  };
  expect((await call("archive")).status).toBe(200);
  expect(calls).toEqual(["teardown", "revoke"]);
  expect(registry.get(app.name)).toBeNull();
  expect(registry.list()).toEqual([]);
  const reloaded = createAppRegistry({ dir, probePort: () => true });
  expect(reloaded.get(app.name, true)).toMatchObject({ archivedAt: expect.any(Number), port: app.port, hostLabel: app.hostLabel });
  expect(registry.admitAppCertificate(app.hostLabel)).toBe("not_live");
  expect(readFileSync(join(app.dataDir, "state.txt"), "utf8")).toBe("keep me");
  expect((await call("restore")).status).toBe(200);
  expect(calls.slice(-2)).toEqual(["token", "install"]);
  expect(registry.get(app.name)?.archivedAt).toBeUndefined();
  expect(existsSync(join(app.dataDir, "state.txt"))).toBe(true);
  deps.teardown = mock(() => {
    throw new Error("still running");
  });
  await expect(call("archive")).rejects.toThrow("still running");
  expect(registry.get(app.name)).not.toBeNull();
});

test("thumbnail uploads require management access and are scoped to an app generation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bureau-thumbnail-"));
  dirs.push(dir);
  const registry = createAppRegistry({ dir, probePort: () => true });
  const app = registry.register({ name: "thumbnail-test", command: "bun app.ts", cwd: dir, userId: "owner", username: "Owner", createdBy: "Owner" });
  records.push(app);
  const deps = { ...defaultAppsDeps, registry, publicUrl: () => null, states: () => new Map() };
  const req = new Request(`http://local/api/apps/${app.name}/thumbnail`, { method: "PUT", body: png });
  const outsider: AuthResult = { kind: "ok", session: { ...owner.session, userId: "other", role: "member" } };
  expect((await handleAppsRequest(req.clone(), new URL(req.url), outsider, deps))?.status).toBe(404);
  expect((await handleAppsRequest(req, new URL(req.url), owner, deps))?.status).toBe(200);
  expect(readThumbnail(app)).toEqual(png);
  const get = new Request(req.url);
  const response = (await handleAppsRequest(get, new URL(get.url), owner, deps))!;
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(() => validateThumbnail(Buffer.from("<svg onload='alert(1)'/>"))).toThrow();
  const oversized = Buffer.from(png);
  oversized.writeUInt32BE(5000, 16);
  expect(() => validateThumbnail(oversized)).toThrow("dimensions");
  registry.remove(app.name);
  const successor = registry.register({ name: app.name, command: "bun app.ts", cwd: dir, userId: "owner", username: "Owner", createdBy: "Owner" });
  records.push(successor);
  expect(readThumbnail(successor)).toBeNull();
});

test("JSON thumbnails require an authorized agent and preserve the image on refusal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bureau-thumbnail-path-"));
  dirs.push(dir);
  const registry = createAppRegistry({ dir, probePort: () => true });
  const app = registry.register({ name: "path-test", command: "bun app.ts", cwd: dir, userId: "owner", username: "Owner", createdBy: "Owner" });
  records.push(app);
  const image = join(dir, "screenshot.png");
  writeFileSync(image, png);
  const deps = { ...defaultAppsDeps, registry, publicUrl: () => null, states: () => new Map() };
  const resolve = spyOn(AgentManager, "resolveEditorPathForAgent").mockReturnValue(image);
  const announce = mock(() => {});
  const identity = { scope: "agent" as const, agentId: "builder", userId: "owner" };
  const request = (body: string) => new Request(`http://local/api/apps/${app.name}/thumbnail`, { method: "PUT", headers: { "Content-Type": "application/json; charset=utf-8" }, body });
  const parts = ["api", "apps", app.name, "thumbnail"];
  try {
    const body = JSON.stringify({ path: "screenshot.png" });
    expect((await handleAppAssetsRequest(request(body), parts, { scope: "user", userId: "owner", username: "Owner", role: "owner" }, deps, announce))?.status).toBe(403);
    expect((await handleAppAssetsRequest(request(body), parts, { ...identity, userId: "other" }, deps, announce))?.status).toBe(404);
    expect(resolve).not.toHaveBeenCalled();
    expect((await handleAppAssetsRequest(request(body), parts, identity, deps, announce))?.status).toBe(200);
    expect(resolve).toHaveBeenCalledWith("builder", "screenshot.png");
    expect(readThumbnail(app)).toEqual(png);
    for (const invalid of ["{}", "null", "{broken", JSON.stringify({ path: "x".repeat(8192) })]) {
      expect((await handleAppAssetsRequest(request(invalid), parts, identity, deps, announce))?.status).toBe(400);
    }
    writeFileSync(image, "not an image");
    expect((await handleAppAssetsRequest(request(body), parts, identity, deps, announce))?.status).toBe(400);
    expect(readThumbnail(app)).toEqual(png);
    expect(announce).toHaveBeenCalledTimes(1);
  } finally {
    resolve.mockRestore();
  }
});
