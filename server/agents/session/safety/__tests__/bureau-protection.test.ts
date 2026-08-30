import { describe, expect, test } from "bun:test";
import { homedir } from "os";
import { basename, dirname } from "path";
import { BUREAU_DIR, commandWritesToBureau } from "../bureau-protection.ts";

describe("commandWritesToBureau — redirections", () => {
  test("blocks > ~/.bureau/foo", () => {
    expect(commandWritesToBureau("echo hi > ~/.bureau/foo")).toBe(true);
  });

  test("blocks >> ~/.bureau/foo", () => {
    expect(commandWritesToBureau("echo hi >> ~/.bureau/foo")).toBe(true);
  });

  test("blocks redirects to absolute BUREAU_DIR path", () => {
    expect(commandWritesToBureau(`echo hi > ${BUREAU_DIR}/foo`)).toBe(true);
  });

  test("blocks relative redirects resolved against the agent cwd", () => {
    expect(commandWritesToBureau("echo hi > .bureau/foo", homedir())).toBe(true);
  });

  test("does not block redirects to other paths", () => {
    expect(commandWritesToBureau("echo hi > /tmp/foo")).toBe(false);
    expect(commandWritesToBureau("echo hi > ~/notes/foo")).toBe(false);
  });
});

describe("commandWritesToBureau — write commands", () => {
  test.each([
    "rm ~/.bureau/foo",
    "rm -rf ~/.bureau/",
    "mv x ~/.bureau/y",
    "mkdir ~/.bureau/new",
    "touch ~/.bureau/marker",
    "chmod 644 ~/.bureau/agents.json",
    "chown me ~/.bureau/agents.json",
    "ln -s x ~/.bureau/y",
    "sed -i s/a/b/ ~/.bureau/cfg.json",
    "tee ~/.bureau/log.txt",
  ])("blocks %s", (cmd) => {
    expect(commandWritesToBureau(cmd)).toBe(true);
  });

  test.each(["python ~/.bureau/script.py", "node ~/.bureau/run.js", "bun ~/.bureau/run.ts"])("blocks scripting interpreters writing under ~/.bureau (%s)", (cmd) => {
    expect(commandWritesToBureau(cmd)).toBe(true);
  });

  test("matches when an absolute /home/<user>/.bureau path is used directly", () => {
    expect(commandWritesToBureau(`rm -rf ${BUREAU_DIR}/cronjobs`)).toBe(true);
  });

  test("does not overmatch siblings of the bureau directory", () => {
    expect(commandWritesToBureau(`rm -rf ${BUREAU_DIR}-workspace`)).toBe(false);
  });

  test("blocks relative paths resolved into the bureau directory", () => {
    expect(commandWritesToBureau("rm .bureau/agents.json", homedir())).toBe(true);
    expect(commandWritesToBureau(`rm ${basename(BUREAU_DIR)}/agents.json`, dirname(BUREAU_DIR))).toBe(true);
  });
});

describe("commandWritesToBureau — copy commands (only block destination writes)", () => {
  test("blocks `cp foo ~/.bureau/foo` (writing TO bureau)", () => {
    expect(commandWritesToBureau("cp foo ~/.bureau/foo")).toBe(true);
  });

  test("blocks `cp foo .bureau/foo` from the user's home", () => {
    expect(commandWritesToBureau("cp foo .bureau/foo", homedir())).toBe(true);
  });

  test("allows `cp ~/.bureau/foo /tmp/foo` (reading FROM bureau)", () => {
    expect(commandWritesToBureau("cp ~/.bureau/foo /tmp/foo")).toBe(false);
  });

  test("blocks `rsync` when the destination is under bureau", () => {
    expect(commandWritesToBureau("rsync -av src/ ~/.bureau/dst/")).toBe(true);
  });

  test("allows `rsync` when only the source is under bureau", () => {
    expect(commandWritesToBureau("rsync -av ~/.bureau/src/ /tmp/dst/")).toBe(false);
  });

  test("blocks `scp` writing into bureau", () => {
    expect(commandWritesToBureau("scp host:foo ~/.bureau/foo")).toBe(true);
  });
});

describe("commandWritesToBureau — read-only commands are allowed", () => {
  test.each([
    "cat ~/.bureau/agents.json",
    "ls ~/.bureau/",
    "head ~/.bureau/log",
    "tail -n 5 ~/.bureau/log",
    "grep foo ~/.bureau/",
    "rg pattern ~/.bureau/",
    "find ~/.bureau/ -name '*.json'",
    "stat ~/.bureau/",
    "wc -l ~/.bureau/log",
    "diff ~/.bureau/a ~/.bureau/b",
  ])("allows %s", (cmd) => {
    expect(commandWritesToBureau(cmd)).toBe(false);
  });
});

describe("commandWritesToBureau — sub-command splitting", () => {
  test("inspects each pipe stage", () => {
    expect(commandWritesToBureau("cat foo | tee ~/.bureau/log")).toBe(true);
  });

  test("inspects each && stage", () => {
    expect(commandWritesToBureau("ls && rm ~/.bureau/foo")).toBe(true);
  });

  test("inspects each ; stage", () => {
    expect(commandWritesToBureau("echo a ; mkdir ~/.bureau/x")).toBe(true);
  });

  test("ignores stages that don't reference ~/.bureau", () => {
    expect(commandWritesToBureau("rm /tmp/foo && ls")).toBe(false);
  });
});

describe("commandWritesToBureau — absolute write-binary paths", () => {
  test("treats /usr/bin/rm the same as bare rm", () => {
    expect(commandWritesToBureau("/usr/bin/rm ~/.bureau/foo")).toBe(true);
  });
});
