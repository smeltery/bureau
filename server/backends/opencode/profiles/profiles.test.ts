import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeProfileStore } from "./store.ts";
import { OpenCodeProfiles } from "./registry.ts";
import { openCodeEnvironmentId } from "./identity.ts";
import type { OpenCodeSupervisor } from "../supervisor.ts";
import { getOpenCodeLoginInstructions } from "../config.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bureau-opencode-profiles-"));
  roots.push(root);
  const store = new OpenCodeProfileStore(root);
  const factory = (profileDir: string) => ({ profileDir }) as OpenCodeSupervisor;
  return { root, store, profiles: new OpenCodeProfiles(store, factory), restart: () => new OpenCodeProfiles(new OpenCodeProfileStore(root), factory) };
}
const model = "provider/model";
const context = (manager: string, room = "room-a", key = "secret-a") => ({ environmentId: openCodeEnvironmentId(manager, room), cwd: "/work", env: { OPENCODE_API_KEY: key } });

test("manager and room profiles are separate while credential rotation preserves history", () => {
  const { profiles, root, restart } = fixture();
  const first = profiles.select(context("alice"), model);
  profiles.bind("session-a", first);
  expect(profiles.select(context("bob"), model).profile).not.toBe(first.profile);
  expect(profiles.select(context("alice", "room-b"), model).profile).not.toBe(first.profile);
  const rotated = restart().select(context("alice", "room-a", "secret-b"), model, undefined, "session-a");
  expect(rotated.profile).toBe(first.profile);
  expect(rotated.resolveEnv()?.OPENCODE_API_KEY).toBe("secret-b");
  expect(() => restart().access("session-a", context("bob"))).toThrow("another manager or room");
  const file = join(root, "session-bindings", readdirSync(join(root, "session-bindings"))[0]!);
  expect(readFileSync(file, "utf8")).not.toContain("secret-");
  expect(statSync(file).mode & 0o777).toBe(0o600);
});

test("legacy resume and forks retain their original store without copying unrelated data", () => {
  const { profiles, store, root, restart } = fixture();
  const legacy = store.profileDir("default");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "untouched-history"), "other session");
  const parent = profiles.select(context("alice"), model, undefined, "legacy-session");
  expect(parent.profile).toBe("default");
  profiles.bind("legacy-session", parent);
  profiles.bind("legacy-fork", parent);
  expect(restart().access("legacy-fork", context("alice")).profile).toBe("default");
  expect(readdirSync(join(root, "profiles"))).toEqual(["default"]);
  expect(readFileSync(join(legacy, "untouched-history"), "utf8")).toBe("other session");
  expect(profiles.select(context("alice"), model).profile).not.toBe("default");
});

test("corrupt bindings fail closed and profile paths cannot escape the store", () => {
  const { profiles, store, root } = fixture();
  profiles.bind("session-a", profiles.select(context("alice"), model));
  const file = join(root, "session-bindings", readdirSync(join(root, "session-bindings"))[0]!);
  writeFileSync(file, "{broken");
  expect(() => profiles.access("session-a", context("alice"))).toThrow();
  expect(() => store.profileDir("../another-user")).toThrow("Invalid");
});

test("sign-in instructions target the exact private data directory", () => {
  const command = getOpenCodeLoginInstructions({ profileDir: "/state/manager's profile" }).commands?.[0];
  expect(command).toContain("XDG_DATA_HOME='/state/manager'\\''s profile/data'");
  expect(command).toEndWith("opencode auth login");
});
