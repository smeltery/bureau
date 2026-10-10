import { chmodSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

// node-pty 1.1.0's macOS prebuilt spawn helper can be unpacked without its
// executable bit. Repair this during installation, before a terminal is opened.
export function preparePtyHelper(root: string, platform = process.platform, arch = process.arch): void {
  if (platform !== "darwin") return;
  for (const directory of ["build/Release", "build/Debug", `prebuilds/${platform}-${arch}`]) {
    const helper = join(root, directory, "spawn-helper");
    if (!existsSync(helper)) continue;
    const stat = statSync(helper);
    if (!stat.isFile()) throw new Error(`PTY spawn helper is not a file: ${helper}`);
    if ((stat.mode & 0o111) !== 0o111) chmodSync(helper, stat.mode | 0o111);
  }
}
if (import.meta.main) preparePtyHelper(dirname(Bun.resolveSync("node-pty/package.json", process.cwd())));
