import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ProviderAccountProvider } from "../../shared/provider-accounts.ts";
import { BUREAU_DIR } from "../persistence/paths.ts";

export function canonicalProviderDirectory(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(canonicalProviderDirectory(parent), absolute.slice(parent.length + (parent.endsWith("/") ? 0 : 1)));
  }
}
export function createProviderHomes(root = BUREAU_DIR) {
  const base = join(root, "provider-homes");
  function home(userId: string, provider: ProviderAccountProvider) {
    if (!/^[A-Za-z0-9_-]+$/.test(userId) || !["claude", "codex"].includes(provider)) throw new Error("Invalid provider account.");
    return join(base, userId, provider);
  }
  function validate(userId: string, provider: ProviderAccountProvider, create: boolean) {
    const path = home(userId, provider);
    for (const directory of [base, dirname(path), path]) {
      if (create) mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (!existsSync(directory)) continue;
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Managed provider directory is not a private directory.");
      if (create) chmodSync(directory, 0o700);
    }
    return path;
  }
  function active(userId: string, provider: ProviderAccountProvider) {
    const path = join(validate(userId, provider, false), ".bureau-active");
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32) throw new Error("Invalid provider activation state.");
      if (readFileSync(path, "utf8") !== "active\n") throw new Error("Invalid provider activation state.");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  function setActive(userId: string, provider: ProviderAccountProvider, value: boolean) {
    const path = join(validate(userId, provider, true), ".bureau-active");
    if (!value) {
      rmSync(path, { force: true });
      return;
    }
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, "active\n", { mode: 0o600, flag: "wx" });
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return { base, home, active, setActive, ensure: (userId: string, provider: ProviderAccountProvider) => validate(userId, provider, true) };
}
export const providerHomes = createProviderHomes();
export function activeProviderEnvironment(userId: string | null | undefined, explicit: Record<string, string | undefined> = {}): Record<string, string> {
  if (!userId) return {};
  const result: Record<string, string> = {};
  for (const [provider, key] of [
    ["claude", "CLAUDE_CONFIG_DIR"],
    ["codex", "CODEX_HOME"],
  ] as const) {
    if (!explicit[key]?.trim() && providerHomes.active(userId, provider)) result[key] = providerHomes.home(userId, provider);
  }
  return result;
}
