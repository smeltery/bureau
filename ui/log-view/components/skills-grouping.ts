import type { SkillInfo, SkillOrigin } from "../../../shared/types.ts";
import type { CommandEntry } from "./SkillsPopover.tsx";

export type GroupKey = "most-used" | "commands" | "bundled" | "user" | "project" | "plugin";

const GROUP_ORDER: GroupKey[] = ["most-used", "commands", "bundled", "user", "project", "plugin"];

const GROUP_LABELS: Record<GroupKey, string> = {
  "most-used": "Most Used",
  commands: "Commands",
  bundled: "Bundled",
  user: "User",
  project: "Project",
  plugin: "Plugin",
};

export const MOST_USED_CAP = 8;

export interface SkillsMenuEntry {
  name: string;
  description?: string;
  count: number;
}

export interface SkillsMenuGroup {
  key: GroupKey;
  label: string;
  entries: SkillsMenuEntry[];
}

function groupForOrigin(origin: SkillOrigin): GroupKey {
  if (origin === "bureau" || origin === "claude") return "bundled";
  return origin;
}

export function buildSkillsMenuGroups(input: { skills: SkillInfo[]; commands: CommandEntry[]; counts: Record<string, number>; filter: string }): SkillsMenuGroup[] {
  const { skills, commands, counts, filter } = input;
  const aliasTargets = new Set([...skills, ...commands].filter((entry) => entry.aliasFor).map((entry) => entry.aliasFor as string));
  const q = filter.trim().toLowerCase();
  const matches = (name: string, description?: string) => !q || name.toLowerCase().includes(q) || (description ?? "").toLowerCase().includes(q);
  const ownCount = (name: string): number => {
    const value = Object.prototype.hasOwnProperty.call(counts, name) ? counts[name] : 0;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  };
  const countFor = (name: string, aliasFor?: string) => ownCount(name) + (aliasFor ? ownCount(aliasFor) : 0);

  const entries: { entry: SkillsMenuEntry; home: GroupKey }[] = [];
  const add = (home: GroupKey, name: string, description?: string, aliasFor?: string) => {
    if (aliasTargets.has(name) || !matches(name, description)) return;
    entries.push({ home, entry: { name, description, count: countFor(name, aliasFor) } });
  };

  for (const command of commands) add("commands", command.name, command.description, command.aliasFor);
  for (const skill of skills) add(groupForOrigin(skill.origin), skill.name, skill.description, skill.aliasFor);

  const mostUsed = entries
    .filter((entry) => entry.entry.count > 0)
    .sort((a, b) => b.entry.count - a.entry.count || a.entry.name.localeCompare(b.entry.name))
    .slice(0, MOST_USED_CAP);
  const promoted = new Set(mostUsed.map((entry) => entry.entry));

  const byGroup = new Map<GroupKey, SkillsMenuEntry[]>();
  if (mostUsed.length > 0)
    byGroup.set(
      "most-used",
      mostUsed.map((entry) => entry.entry),
    );
  for (const entry of entries) {
    if (promoted.has(entry.entry)) continue;
    const groupEntries = byGroup.get(entry.home) ?? [];
    groupEntries.push(entry.entry);
    byGroup.set(entry.home, groupEntries);
  }
  for (const [group, groupEntries] of byGroup) {
    if (group !== "most-used") groupEntries.sort((a, b) => a.name.localeCompare(b.name));
  }

  return GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => ({
    key: group,
    label: GROUP_LABELS[group],
    entries: byGroup.get(group)!,
  }));
}
