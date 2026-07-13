import { existsSync, readFileSync } from "fs";

// Extract description from SKILL.md / command .md YAML frontmatter
export function extractSkillDescription(filePath: string): string | undefined {
  return extractSkillFrontmatter(filePath).description;
}

// Extract description + optional alias from SKILL.md frontmatter. Only
// bundled skills honor `alias:`; user/project/plugin skills don't.
export function extractBundledSkillFrontmatter(filePath: string): {
  description?: string;
  alias?: string;
} {
  return extractSkillFrontmatter(filePath);
}

export function readSkillFile(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf-8");
    const stripped = content.replace(/^---\n[\s\S]*?\n---\n*/, "");
    return stripped.trim();
  } catch {
    return null;
  }
}

export function hasUserInvocableFalse(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, "utf-8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    return Boolean(fmMatch && /user-invocable:\s*false/i.test(fmMatch[1]));
  } catch {
    return false;
  }
}

function extractSkillFrontmatter(filePath: string): {
  description?: string;
  alias?: string;
} {
  try {
    const content = readFileSync(filePath, "utf-8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return {};
    const descMatch = fmMatch[1].match(/description:\s*(.+)/);
    const aliasMatch = fmMatch[1].match(/alias:\s*(.+)/);
    return {
      description: descMatch ? descMatch[1].trim() : undefined,
      alias: aliasMatch ? aliasMatch[1].trim() : undefined,
    };
  } catch {
    return {};
  }
}
