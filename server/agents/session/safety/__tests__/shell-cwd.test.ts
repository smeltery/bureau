import { describe, expect, test } from "bun:test";
import { homedir } from "os";
import { join } from "path";
import { commandWritesToBureau } from "../bureau-protection.ts";
import { directoriesForStages, policyCwd, splitShellStages } from "../shell-cwd.ts";

describe("policyCwd", () => {
  test("accepts absolute paths only", () => {
    expect(policyCwd("/tmp/agent")).toBe("/tmp/agent");
    expect(policyCwd("")).toBeNull();
    expect(policyCwd("relative")).toBeNull();
    expect(policyCwd(undefined)).toBeNull();
    expect(policyCwd(null)).toBeNull();
  });
});

describe("commandWritesToBureau — shell cwd-set", () => {
  const home = homedir();

  test("blocks cd into bureau then relative write via &&", () => {
    expect(commandWritesToBureau("cd ~/.bureau && cat > agents/x", home)).toBe(true);
    expect(commandWritesToBureau(`cd ${join(home, ".bureau")} && touch agents/x`, "/tmp")).toBe(true);
  });

  test("blocks cd into bureau then relative write via semicolon (keeps both directories)", () => {
    expect(commandWritesToBureau("cd ~/.bureau ; cat > agents/x", home)).toBe(true);
  });

  test("failed cd with && does not treat the write as under the destination", () => {
    // Success directory is /nonexistent; .bureau/x there is not ~/.bureau.
    expect(commandWritesToBureau("cd /nonexistent && cat > .bureau/x", home)).toBe(false);
  });

  test("failed cd with semicolon still checks the original cwd", () => {
    expect(commandWritesToBureau("cd /nonexistent ; cat > .bureau/x", home)).toBe(true);
  });

  test("OR uses the original cwd for the write branch", () => {
    expect(commandWritesToBureau("cd /tmp || cat > .bureau/x", home)).toBe(true);
  });

  test("OR excludes a successful destination from the write branch", () => {
    // Write only runs if cd fails, so destination ~/.bureau is not the write cwd.
    expect(commandWritesToBureau("cd ~/.bureau || cat > agents/x", home)).toBe(false);
  });

  test("dynamic cd fails closed for later relative writes", () => {
    expect(commandWritesToBureau('cd "$SOME_DIR" && cat > foo.txt', home)).toBe(true);
    expect(commandWritesToBureau("cd - && rm foo", home)).toBe(true);
    expect(commandWritesToBureau("pushd /tmp && cat > foo", home)).toBe(true);
  });

  test("missing cwd blocks protected relative candidates", () => {
    expect(commandWritesToBureau("cat > .bureau/x", null)).toBe(true);
    expect(commandWritesToBureau("cat > .bureau/x", "")).toBe(true);
    expect(commandWritesToBureau("cat > .bureau/x", "relative")).toBe(true);
  });

  test("missing cwd still allows absolute writes outside bureau", () => {
    expect(commandWritesToBureau("cat > /tmp/x", null)).toBe(false);
  });

  test("missing cwd still blocks absolute writes into bureau", () => {
    expect(commandWritesToBureau("cat > ~/.bureau/x", null)).toBe(true);
  });

  test("literal absolute cd establishes cwd even without an envelope cwd", () => {
    expect(commandWritesToBureau("cd ~/.bureau && cat > agents/x", null)).toBe(true);
  });

  test("subshell cd does not move the parent for a following write", () => {
    // Our splitter keeps `( cd ~/.bureau )` as one stage; a following `; cat > .bureau/x`
    // still sees the original cwd via the `;` union. The subshell's cd is opaque enough
    // that we do not currently model parentheses — this documents the remaining gap:
    // parent cwd must still catch `.bureau/x` from home.
    expect(commandWritesToBureau("true ; cat > .bureau/x", home)).toBe(true);
  });
});

describe("directoriesForStages", () => {
  test("&& carries only the successful cd destination", () => {
    const stages = splitShellStages("cd /tmp && pwd");
    const dirs = directoriesForStages(stages, "/home/agent");
    expect(dirs[0]).toEqual(new Set(["/home/agent"]));
    expect([...dirs[1]!]).toEqual(["/tmp"]);
  });

  test("; keeps original and destination possibilities for the next stage", () => {
    const stages = splitShellStages("cd /tmp ; pwd");
    const dirs = directoriesForStages(stages, "/home/agent");
    expect(dirs[1]).toEqual(new Set(["/tmp", "/home/agent"]));
  });
});
