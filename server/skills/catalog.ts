import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentBackendType, SkillInfo } from "../../shared/types.ts";
import type { LibrarySkill, SkillLibrary } from "../../shared/skills/library.ts";
import { BUREAU_CODEX_HOME } from "../backends/codex/native-bin.ts";
import { commands } from "../agents/commands.ts";
import { BUNDLED_SKILLS_DIR } from "../agents/skills-discovery.ts";
import { absent, digest, entries, readDocument, SkillError } from "./files.ts";

export interface SkillContext {
  cwd: string;
  agentType?: AgentBackendType;
  env?: Record<string, string | undefined>;
  writable?: boolean;
}
export interface Root {
  id: string;
  label: string;
  path: string;
  writable: boolean;
  commands?: boolean;
  origin: SkillInfo["origin"];
  prefix?: string;
}
export interface Catalog {
  roots: Root[];
  files: Map<string, { path: string; skill: LibrarySkill; origin: SkillInfo["origin"] }>;
}
export function rootsFor(context: SkillContext): Root[] {
  const env = context.env ?? process.env;
  const roots: Root[] = [];
  const add = (path: string, label: string, origin: Root["origin"], writable = false, commands = false, prefix?: string) => {
    path = resolve(path);
    if (!roots.some((root) => root.path === path)) roots.push({ id: digest(path), path, label, origin, writable, commands, prefix });
  };
  if (context.agentType === "opencode") return roots;
  if (context.agentType === "codex") {
    add(join(env.CODEX_HOME || BUREAU_CODEX_HOME, "skills"), "Codex personal", "user", !!context.writable);
    add(join(env.HOME || homedir(), ".agents", "skills"), "Shared personal", "user", !!context.writable);
    add(join(context.cwd, ".agents", "skills"), "Project", "project", !!context.writable);
  } else {
    const config = env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude");
    add(join(config, "skills"), "Claude personal", "user", !!context.writable);
    add(join(config, "commands"), "Claude commands", "user", !!context.writable, true);
    add(join(context.cwd, ".claude", "skills"), "Project", "project", !!context.writable);
    add(join(context.cwd, ".claude", "commands"), "Project commands", "project", !!context.writable, true);
    try {
      const manifest = JSON.parse(readDocument(join(config, "plugins", "installed_plugins.json")).content);
      for (const [key, installs] of Object.entries(manifest.plugins ?? {})) {
        if (!Array.isArray(installs)) continue;
        for (const install of installs) {
          if (typeof install?.installPath !== "string") continue;
          if (install.projectPath && resolve(install.projectPath) !== resolve(context.cwd)) continue;
          const prefix = key.split("@")[0];
          add(join(install.installPath, "skills"), `Plugin: ${prefix}`, "plugin", false, false, prefix);
          add(join(install.installPath, "commands"), `Plugin commands: ${prefix}`, "plugin", false, true, prefix);
        }
      }
    } catch (error) {
      if (!absent(error)) throw error;
    }
  }
  add(BUNDLED_SKILLS_DIR, "Bureau", "bureau");
  return roots;
}
export function catalogFor(context: SkillContext): Catalog {
  const roots = rootsFor(context);
  const files: Catalog["files"] = new Map();
  for (const root of roots) {
    for (const entry of entries(root.path)) {
      if (entry.isSymbolicLink()) continue;
      if (root.commands ? !entry.isFile() || !entry.name.endsWith(".md") : !entry.isDirectory()) continue;
      const path = root.commands ? join(root.path, entry.name) : join(root.path, entry.name, "SKILL.md");
      let content: string;
      try {
        content = readDocument(path).content;
      } catch (error) {
        if (absent(error)) continue;
        throw error;
      }
      const front = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? "";
      const field = (key: string) =>
        front
          .match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]
          .trim()
          .replace(/^['"]|['"]$/g, "");
      const name = root.commands ? entry.name.slice(0, -3) : entry.name;
      const alias = root.origin === "bureau" ? field("alias") : undefined;
      const id = digest(path);
      files.set(id, {
        path,
        origin: root.origin,
        skill: {
          id,
          rootId: root.id,
          name: root.prefix ? `${root.prefix}:${name}` : name,
          description: field("description"),
          aliases: alias && alias !== name ? [alias] : [],
          writable: root.writable,
        },
      });
      if (files.size > 4000) throw new SkillError("Skill library exceeds the 4,000-file limit.");
    }
  }
  return { roots, files };
}
export function publicCatalog(catalog: Catalog): SkillLibrary {
  return {
    roots: catalog.roots.map(({ id, label, writable }) => ({ id, label, writable })),
    skills: [...catalog.files.values()].map((file) => file.skill),
    commands: Object.entries(commands)
      .filter(([, cfg]) => cfg.type === "hardcoded" && cfg.supported && !cfg.aliasFor)
      .map(([name, cfg]) => ({
        name,
        description: cfg.description,
        aliases: Object.entries(commands)
          .filter(([, alias]) => alias.aliasFor === name)
          .map(([alias]) => alias),
      })),
  };
}
export function contextSkills(context: SkillContext): SkillInfo[] {
  try {
    return discoveredSkills(context);
  } catch (error) {
    console.error("[skills] Discovery failed:", error);
    return [];
  }
}
function discoveredSkills(context: SkillContext): SkillInfo[] {
  const found = new Map<string, SkillInfo>();
  for (const { skill, origin } of catalogFor(context).files.values()) {
    for (const name of [skill.name, ...skill.aliases])
      if (!found.has(name)) found.set(name, { name, origin, description: skill.description, ...(name !== skill.name ? { aliasFor: skill.name } : {}) });
  }
  return [...found.values()];
}
export function contextPrompt(name: string, context: SkillContext): string | null {
  const file = [...catalogFor(context).files.values()].find(({ skill }) => skill.name === name || skill.aliases.includes(name));
  return file
    ? readDocument(file.path)
        .content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "")
        .trim()
    : null;
}
