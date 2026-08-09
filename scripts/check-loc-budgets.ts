import { readFileSync } from "node:fs";
import { dirname, extname } from "node:path";
import { spawnSync } from "node:child_process";

type FileBudgets = {
  default_lines: number;
  files: Record<string, number>;
};

type DirectoryBudget = {
  limit: number;
  reason?: string;
};

type FlatDirectoryBudgets = {
  default_files: number;
  directories: Record<string, number | DirectoryBudget>;
};

const SOURCE_EXTENSIONS = new Set([".css", ".cjs", ".js", ".jsx", ".json", ".md", ".mjs", ".sh", ".ts", ".tsx", ".yaml", ".yml"]);
const EXCLUDED_PATH_SEGMENTS = new Set(["node_modules", "target", "dist", "build", "deps", "_build", "site", "fixtures", "vendor", ".git", "_generated"]);
const EXCLUDED_FILENAMES = new Set(["bun.lock", "package-lock.json", "manifest.lock"]);
const EXCLUDED_ASSET_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function trackedFiles(): string[] {
  const result = spawnSync("git", ["ls-files"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "git ls-files failed");
  }
  return result.stdout.split("\n").filter(Boolean);
}

function isBudgetedPath(path: string): boolean {
  const parts = path.split("/");
  if (parts.some((part) => EXCLUDED_PATH_SEGMENTS.has(part))) return false;
  const filename = parts.at(-1);
  if (filename && EXCLUDED_FILENAMES.has(filename)) return false;
  const extension = extname(path);
  if (EXCLUDED_ASSET_EXTENSIONS.has(extension)) return false;
  return SOURCE_EXTENSIONS.has(extension);
}

function lineCount(path: string): number {
  const text = readFileSync(path, "utf8");
  if (text.length === 0) return 0;
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

function directoryLimit(budgets: FlatDirectoryBudgets, dir: string): number {
  const override = budgets.directories[dir];
  if (override == null) return budgets.default_files;
  return typeof override === "number" ? override : override.limit;
}

function main() {
  const fileBudgetsPath = process.argv[2] ?? "scripts/file-size-budgets.json";
  const flatBudgetsPath = process.argv[3] ?? "scripts/flat-directory-budgets.json";
  const fileBudgets = readJson<FileBudgets>(fileBudgetsPath);
  const flatBudgets = readJson<FlatDirectoryBudgets>(flatBudgetsPath);
  const files = trackedFiles().filter(isBudgetedPath);

  const failures: string[] = [];
  for (const file of files) {
    const actual = lineCount(file);
    const limit = fileBudgets.files[file] ?? fileBudgets.default_lines;
    if (actual > limit) {
      failures.push(`${file}: ${actual} lines > budget ${limit}`);
    }
  }

  const directoryCounts = new Map<string, number>();
  for (const file of files) {
    const dir = dirname(file);
    directoryCounts.set(dir, (directoryCounts.get(dir) ?? 0) + 1);
  }
  for (const [dir, actual] of [...directoryCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const limit = directoryLimit(flatBudgets, dir);
    if (actual > limit) {
      failures.push(`${dir}: ${actual} direct files > budget ${limit}`);
    }
  }

  if (failures.length > 0) {
    console.error("LOC budget check failed:");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }

  console.log(`LOC budget check passed for ${files.length} tracked source files.`);
}

main();
