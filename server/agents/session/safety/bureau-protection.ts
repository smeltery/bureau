import { isAbsolute, resolve } from "path";
import { homedir } from "os";
import { BUREAU_DIR as RAW_BUREAU_DIR, DEFAULT_BUREAU_DIR as RAW_DEFAULT_BUREAU_DIR } from "../../../persistence/paths.ts";

export const BUREAU_DIR = resolve(RAW_BUREAU_DIR);
const DEFAULT_BUREAU_DIR = resolve(RAW_DEFAULT_BUREAU_DIR);

// ---------------------------------------------------------------------------
// Bureau config protection — block writes to ~/.bureau/
// ---------------------------------------------------------------------------

// Commands that only read — safe to run against ~/.bureau/
const READ_ONLY_COMMANDS = ["cat", "ls", "head", "tail", "less", "grep", "rg", "find", "stat", "wc", "file", "diff", "bat", "jq", "tree"];

// Copy-like commands where only the last argument (destination) is a write target.
// Reading from ~/.bureau/ via these is fine; only writing to it should be blocked.
const COPY_COMMANDS = ["cp", "rsync", "scp", "install"];

// Commands that can modify files — if these target ~/.bureau/, block them
const WRITE_COMMANDS = ["cp", "mv", "rm", "mkdir", "rmdir", "touch", "chmod", "chown", "tee", "dd", "install", "rsync", "scp", "ln", "sed", "awk", "perl", "python", "python3", "ruby", "node", "bun"];

// Silence unused-warning for the READ_ONLY list (documentational allowlist).
void READ_ONLY_COMMANDS;

function pathTargetsBureau(path: string, cwd: string): boolean {
  const unquoted = path.replace(/^['"]|['"]$/g, "");
  const resolved = unquoted.startsWith("~/") ? resolve(homedir(), unquoted.slice(2)) : unquoted === "~" ? homedir() : isAbsolute(unquoted) ? resolve(unquoted) : resolve(cwd, unquoted);
  return resolved === BUREAU_DIR || resolved.startsWith(BUREAU_DIR + "/") || resolved === DEFAULT_BUREAU_DIR || resolved.startsWith(DEFAULT_BUREAU_DIR + "/");
}

export function commandWritesToBureau(command: string, cwd: string = process.cwd()): boolean {
  // Check 1: Redirection (> or >>) targeting ~/.bureau/
  // Match: > ~/.bureau/, >> .bureau/foo, or > /home/user/.bureau/foo.
  for (const match of command.matchAll(/(?:^|\s)>>?\s*(\S+)/g)) {
    const target = match[1];
    if (target && pathTargetsBureau(target, cwd)) return true;
  }

  // Check 2: Write commands with ~/.bureau/ as an argument
  // Split on pipe/semicolon/&&/|| to get individual sub-commands
  const subCommands = command.split(/[|;&]+/).map((s) => s.trim());
  for (const sub of subCommands) {
    const firstToken = sub.split(/\s+/)[0]?.replace(/^.*\//, "") ?? "";
    if (!WRITE_COMMANDS.includes(firstToken)) continue;
    const args = sub.split(/\s+/).slice(1);

    // For copy-like commands, only the destination (last arg) is a write target.
    // Reading *from* ~/.bureau/ is fine — only block if writing *to* it.
    if (COPY_COMMANDS.includes(firstToken)) {
      const positional = args.filter((a) => !a.startsWith("-"));
      const dest = positional[positional.length - 1] ?? "";
      if (pathTargetsBureau(dest, cwd)) return true;
      continue;
    }

    if (args.some((arg) => !arg.startsWith("-") && pathTargetsBureau(arg, cwd))) return true;
  }

  return false;
}
