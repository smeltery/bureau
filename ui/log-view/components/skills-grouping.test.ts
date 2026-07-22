import { describe, expect, test } from "bun:test";
import type { SkillInfo } from "../../../shared/types.ts";
import { buildSkillsMenuGroups, MOST_USED_CAP } from "./skills-grouping.ts";
import type { CommandEntry } from "./SkillsPopover.tsx";

const skill = (name: string, origin: SkillInfo["origin"] = "user", aliasFor?: string): SkillInfo => ({ name, origin, aliasFor });
const command = (name: string, aliasFor?: string, autoRun?: boolean): CommandEntry => ({ name, aliasFor, ...(autoRun === true ? { autoRun: true } : {}) });

const names = (groups: ReturnType<typeof buildSkillsMenuGroups>, key: string): string[] => groups.find((group) => group.key === key)?.entries.map((entry) => entry.name) ?? [];

function build(input: { skills?: SkillInfo[]; commands?: CommandEntry[]; counts?: Record<string, number>; filter?: string }) {
  return buildSkillsMenuGroups({
    skills: input.skills ?? [],
    commands: input.commands ?? [],
    counts: input.counts ?? {},
    filter: input.filter ?? "",
  });
}

describe("buildSkillsMenuGroups", () => {
  test("keeps the grouped alphabetical layout when there are no counts", () => {
    const groups = build({
      commands: [command("help"), command("clear")],
      skills: [skill("z-user"), skill("a-bundled", "bureau")],
    });
    expect(groups.map((group) => group.key)).toEqual(["commands", "bundled", "user"]);
    expect(names(groups, "commands")).toEqual(["clear", "help"]);
    expect(names(groups, "bundled")).toEqual(["a-bundled"]);
    expect(names(groups, "user")).toEqual(["z-user"]);
  });

  test("ranks commands and skills together by count then name", () => {
    const groups = build({
      commands: [command("clear"), command("help")],
      skills: [skill("tdd"), skill("verify")],
      counts: { clear: 9, tdd: 5, verify: 5 },
    });
    expect(names(groups, "most-used")).toEqual(["clear", "tdd", "verify"]);
    expect(names(groups, "commands")).toEqual(["help"]);
  });

  test("caps most-used and leaves overflow entries in their home group", () => {
    const commands = Array.from({ length: MOST_USED_CAP }, (_, index) => command(`cmd-${index}`));
    const counts = Object.fromEntries(commands.map((entry, index) => [entry.name, 100 - index]));
    counts.overflow = 1;
    const groups = build({ commands, skills: [skill("overflow")], counts });
    expect(names(groups, "most-used")).toHaveLength(MOST_USED_CAP);
    expect(names(groups, "most-used")).not.toContain("overflow");
    expect(groups.find((group) => group.key === "user")?.entries).toEqual([expect.objectContaining({ name: "overflow", count: 1 })]);
  });

  test("hides alias targets and lets aliases absorb target counts", () => {
    const groups = build({
      commands: [command("diff", "bureau-diff"), command("bureau-diff")],
      skills: [skill("handoff", "bureau", "bureau-soft-handoff"), skill("bureau-soft-handoff", "bureau")],
      counts: { diff: 1, "bureau-diff": 2, "bureau-soft-handoff": 4 },
    });
    expect(names(groups, "most-used")).toEqual(["handoff", "diff"]);
    expect(groups.flatMap((group) => group.entries.map((entry) => entry.name))).not.toContain("bureau-diff");
    expect(groups.flatMap((group) => group.entries.map((entry) => entry.name))).not.toContain("bureau-soft-handoff");
  });

  test("does not read inherited Object.prototype count names", () => {
    const groups = build({ skills: [skill("constructor"), skill("plain")], counts: { plain: 1 } });
    expect(names(groups, "most-used")).toEqual(["plain"]);
    expect(names(groups, "user")).toEqual(["constructor"]);
  });

  test("filters before ranking", () => {
    const groups = build({
      commands: [command("help")],
      skills: [skill("tdd")],
      counts: { help: 9, tdd: 1 },
      filter: "tdd",
    });
    expect(names(groups, "most-used")).toEqual(["tdd"]);
    expect(groups.find((group) => group.key === "commands")).toBeUndefined();
  });

  test("preserves auto-run metadata on command entries only", () => {
    const groups = build({
      commands: [command("context", undefined, true), command("bureau-edit")],
      skills: [skill("context-helper")],
    });
    expect(groups.find((group) => group.key === "commands")?.entries).toEqual([expect.objectContaining({ name: "bureau-edit" }), expect.objectContaining({ name: "context", autoRun: true })]);
    expect(groups.find((group) => group.key === "user")?.entries).toEqual([expect.not.objectContaining({ autoRun: true })]);
  });
});
