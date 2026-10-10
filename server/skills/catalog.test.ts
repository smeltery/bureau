import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogFor, contextPrompt, contextSkills, publicCatalog, rootsFor, type SkillContext } from "./catalog.ts";
import { deleteDocument, readDocument, writeDocument } from "./files.ts";
let directory: string;
let context: SkillContext;
beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "bureau-skills-")));
  context = { cwd: join(directory, "project"), env: { HOME: directory, CLAUDE_CONFIG_DIR: join(directory, "config") }, writable: true };
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function prompt(root: string, name: string, content = "---\ndescription: Test skill\n---\nDo a thing.") {
  const path = join(root, name, "SKILL.md");
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(path, content);
  return path;
}
test("catalog and invocation use the same configured provider and project roots", () => {
  const path = prompt(join(directory, "config", "skills"), "personal");
  prompt(join(directory, ".claude", "skills"), "wrong-home");
  prompt(join(context.cwd, ".claude", "skills"), "project");
  const library = publicCatalog(catalogFor(context));
  expect(library.skills.some((skill) => skill.name === "personal")).toBe(true);
  expect(contextSkills(context).some((skill) => skill.name === "project")).toBe(true);
  expect(contextSkills(context).some((skill) => skill.name === "wrong-home")).toBe(false);
  expect(contextPrompt("personal", context)).toBe("Do a thing.");
  expect(JSON.stringify(library)).not.toContain(path);
  expect(contextPrompt("../../private", context)).toBeNull();
});
test("Codex catalog respects CODEX_HOME and includes shared and project skills", () => {
  context.agentType = "codex";
  context.env!.CODEX_HOME = join(directory, "codex");
  prompt(join(directory, "codex", "skills"), "personal");
  prompt(join(directory, ".agents", "skills"), "shared");
  prompt(join(context.cwd, ".agents", "skills"), "project");
  expect(contextSkills(context).map((skill) => skill.name)).toEqual(expect.arrayContaining(["personal", "shared", "project"]));
  expect(rootsFor({ ...context, agentType: "opencode" })).toEqual([]);
});
test("bundled aliases share one immutable editor entry and commands are separate", () => {
  const library = publicCatalog(catalogFor(context));
  const aliased = library.skills.find((skill) => skill.aliases.length);
  expect(aliased).toBeDefined();
  expect(aliased!.writable).toBe(false);
  expect(library.skills.some((skill) => skill.name === aliased!.aliases[0])).toBe(false);
  expect(library.commands.some((command) => command.name === "clear")).toBe(true);
  expect(contextPrompt(aliased!.aliases[0], context)).toBe(contextPrompt(aliased!.name, context));
});
test("writes detect stale versions and deletion preserves adjacent assets", () => {
  const path = prompt(join(directory, "config", "skills"), "edit");
  const asset = join(directory, "config", "skills", "edit", "asset.txt");
  writeFileSync(asset, "keep");
  const original = readDocument(path);
  writeDocument(path, "new", original.version);
  expect(() => writeDocument(path, "overwrite", original.version)).toThrow("changed on disk");
  expect(() => deleteDocument(path, original.version)).toThrow("changed on disk");
  deleteDocument(path, readDocument(path).version);
  expect(existsSync(path)).toBe(false);
  expect(readFileSync(asset, "utf8")).toBe("keep");
});
test("creation never overwrites and reads reject symlinks, binary and oversized files", () => {
  const path = prompt(directory, "one");
  expect(() => writeDocument(path, "overwrite", null)).toThrow("already exists");
  symlinkSync(join(directory, "one"), join(directory, "alias"));
  expect(() => readDocument(join(directory, "alias", "SKILL.md"))).toThrow("Symbolic");
  expect(() => writeDocument(join(directory, "alias", "new.md"), "bad", null)).toThrow("Symbolic");
  writeFileSync(path, "\0");
  expect(() => readDocument(path)).toThrow("text file");
  writeFileSync(path, "x".repeat(256 * 1024 + 1));
  expect(() => readDocument(path)).toThrow("256 KiB");
});
test("installed plugin files remain read-only and deduplicate repeated installations", () => {
  const installPath = join(directory, "plugin");
  prompt(join(installPath, "skills"), "example");
  mkdirSync(join(directory, "config", "plugins"), { recursive: true });
  writeFileSync(join(directory, "config", "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "helper@test": [{ installPath }, { installPath }] } }));
  const found = publicCatalog(catalogFor(context)).skills.filter((skill) => skill.name === "helper:example");
  expect(found).toHaveLength(1);
  expect(found[0].writable).toBe(false);
});
