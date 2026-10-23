import { realpathSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(absolute);
    return parent === absolute ? absolute : resolve(canonicalPath(parent), basename(absolute));
  }
}

export function assertTestStateIsolated(stateRoot: string, defaultRoot: string, env: NodeJS.ProcessEnv, main: string | undefined): void {
  const testing = env.NODE_ENV === "test" || (main !== undefined && /[._](test|spec)\.[cm]?[jt]sx?$/.test(main));
  if (!testing) return;
  const location = relative(canonicalPath(defaultRoot), canonicalPath(stateRoot));
  if (location === "" || (location !== ".." && !location.startsWith(`..${sep}`) && !location.startsWith(sep))) {
    throw new Error(
      "Refusing to run tests against the live Bureau state directory. Run bun test from the repository root or set BUREAU_HOME to a disposable directory; pass env: process.env to test subprocesses.",
    );
  }
}
