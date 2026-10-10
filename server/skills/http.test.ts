import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleSkillsRequest } from "./http.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { rootsFor, type SkillContext } from "./catalog.ts";
let directory: string;
let context: SkillContext;
const owner: AuthResult = {
  kind: "ok",
  session: { userId: "owner", username: "Owner", role: "owner", sessionIdHash: "hash", sessionPrefix: "prefix", needsRolling: false, absoluteExpiresAt: Date.now() + 60000 },
};
beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "bureau-skills-http-")));
  context = { cwd: directory, env: { HOME: directory }, writable: true };
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
async function call(method = "GET", body?: unknown, id?: string, auth: AuthResult | undefined = owner, origin = "http://localhost:4000") {
  const url = new URL("http://localhost:4000/api/skills?agentId=test");
  if (id) url.searchParams.set("id", id);
  return (await handleSkillsRequest(new Request(url, { method, headers: { origin }, body: body === undefined ? undefined : JSON.stringify(body) }), url, auth, () => context))!;
}
test("requires browser identity, rejects foreign origins and cannot expose arbitrary paths", async () => {
  expect((await call("GET", undefined, undefined, { kind: "loopback" })).status).toBe(401);
  expect((await call("POST", {}, undefined, owner, "https://evil.test")).status).toBe(403);
  expect((await call("GET", undefined, "../../secrets")).status).toBe(404);
  const url = new URL("http://localhost:4000/api/skills?agentId=missing");
  expect((await handleSkillsRequest(new Request(url), url, owner))!.status).toBe(404);
});
test("create/read/save/delete round trip detects conflicts and denies packaged writes", async () => {
  const rootId = rootsFor(context)[0].id;
  expect((await call("POST", { rootId, name: "../escape", content: "bad" })).status).toBe(400);
  expect((await call("POST", { rootId, name: "test", content: "first" })).status).toBe(200);
  expect((await call("POST", { rootId, name: "test", content: "overwrite" })).status).toBe(409);
  const catalog = await (await call()).json();
  const id = catalog.skills.find((skill: { name: string }) => skill.name === "test").id;
  const first = await (await call("GET", undefined, id)).json();
  expect((await call("PUT", { content: "second", version: first.version }, id)).status).toBe(200);
  expect((await call("DELETE", { version: first.version }, id)).status).toBe(409);
  const second = await (await call("GET", undefined, id)).json();
  expect(second.content).toBe("second");
  const bundled = catalog.skills.find((skill: { writable: boolean }) => !skill.writable);
  expect((await call("DELETE", { version: "invalid" }, bundled.id)).status).toBe(403);
  expect((await call("DELETE", { version: second.version }, id)).status).toBe(200);
  expect((await call("GET", undefined, id)).status).toBe(404);
});
test("read-only contexts never mutate shared skills", async () => {
  const rootId = rootsFor(context)[0].id;
  context.writable = false;
  expect((await call("POST", { rootId, name: "test", content: "bad" })).status).toBe(403);
  const catalog = await (await call()).json();
  expect(catalog.roots.every((root: { writable: boolean }) => !root.writable)).toBe(true);
});
