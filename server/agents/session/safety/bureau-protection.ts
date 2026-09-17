import { isAbsolute, resolve } from "path";
import { homedir } from "os";
import { BUREAU_DIR as RAW_BUREAU_DIR, DEFAULT_BUREAU_DIR as RAW_DEFAULT_BUREAU_DIR } from "../../../persistence/paths.ts";
import { directoriesForStages, splitShellStages, stageWritesToProtected, type ShellDirectory } from "./shell-cwd.ts";

export const BUREAU_DIR = resolve(RAW_BUREAU_DIR);
const DEFAULT_BUREAU_DIR = resolve(RAW_DEFAULT_BUREAU_DIR);
const PROTECTED_SEGMENT = ".bureau";

// ---------------------------------------------------------------------------
// Bureau config protection — block writes to ~/.bureau/
// ---------------------------------------------------------------------------

// Commands that only read — safe to run against ~/.bureau/
const READ_ONLY_COMMANDS = ["cat", "ls", "head", "tail", "less", "grep", "rg", "find", "stat", "wc", "file", "diff", "bat", "jq", "tree"];

// Copy-like commands where only the last argument (destination) is a write target.
// Reading from ~/.bureau/ via these is fine; only writing to it should be blocked.
const COPY_COMMANDS = ["cp", "rsync", "scp", "install"];

// Commands that can modify files — if these target ~/.bureau/, block them
const WRITE_COMMANDS = ["cp", "mv", "rm", "mkdir", "rmdir", "touch", "chmod", "chown", "tee", "install", "rsync", "scp", "ln", "sed", "awk", "perl", "python", "python3", "ruby", "node", "bun"];

// Silence unused-warning for the READ_ONLY list (documentational allowlist).
void READ_ONLY_COMMANDS;

function pathTargetsBureau(path: string, cwd: ShellDirectory): boolean {
  const unquoted = path.replace(/^['"]|['"]$/g, "");
  let resolved: string;
  if (unquoted.startsWith("~/")) {
    resolved = resolve(homedir(), unquoted.slice(2));
  } else if (unquoted === "~") {
    resolved = homedir();
  } else if (isAbsolute(unquoted)) {
    resolved = resolve(unquoted);
  } else if (typeof cwd === "string") {
    resolved = resolve(cwd, unquoted);
  } else {
    return false;
  }
  return resolved === BUREAU_DIR || resolved.startsWith(BUREAU_DIR + "/") || resolved === DEFAULT_BUREAU_DIR || resolved.startsWith(DEFAULT_BUREAU_DIR + "/");
}

/** Collect write destinations from a single shell stage (no `;`/`&&`/`||` splits). */
function collectWriteTargets(stage: string): string[] {
  const targets: string[] = [];

  for (const match of stage.matchAll(/(?:^|\s)>>?\s*(\S+)/g)) {
    const target = match[1];
    if (target) targets.push(target);
  }

  // Split pipes inside the stage so `cat x | tee dest` is checked.
  for (const sub of stage.split(/\|+/).map((s) => s.trim())) {
    const firstToken = sub.split(/\s+/)[0]?.replace(/^.*\//, "") ?? "";
    const args = sub.split(/\s+/).slice(1);

    if (firstToken === "dd") {
      for (const arg of args) {
        if (arg.startsWith("of=") && arg.length > 3) targets.push(arg.slice(3));
      }
      continue;
    }

    if (firstToken === "truncate") {
      targets.push(...truncateFileOperands(args));
      continue;
    }

    if (!WRITE_COMMANDS.includes(firstToken)) continue;

    if (COPY_COMMANDS.includes(firstToken)) {
      const positional = args.filter((a) => !a.startsWith("-"));
      const dest = positional[positional.length - 1];
      if (dest) targets.push(dest);
      continue;
    }

    for (const arg of args) {
      if (!arg.startsWith("-")) targets.push(arg);
    }
  }

  return targets;
}

/** Output operands of truncate, excluding -r/--reference and -s/--size values. */
function truncateFileOperands(args: string[]): string[] {
  const operands: string[] = [];
  let endOfOptions = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!endOfOptions && arg === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && ["-r", "--reference", "-s", "--size"].includes(arg)) {
      i++;
      continue;
    }
    if (!endOfOptions && arg.startsWith("-")) continue;
    operands.push(arg);
  }
  return operands;
}

/**
 * True when a Bash command would write into ~/.bureau/.
 *
 * Tracks `cd` across `;` / `&&` / `||` / newlines so relative paths are checked
 * against every directory the shell could still be in. Missing or non-absolute
 * agent cwd no longer falls back to the bureau server's process.cwd().
 */
export function commandWritesToBureau(command: string, cwd?: string | null): boolean {
  const stages = splitShellStages(command);
  if (stages.length === 0) return false;
  const directories = directoriesForStages(stages, cwd);
  const probe = {
    pathWrites: pathTargetsBureau,
    protectedSegment: PROTECTED_SEGMENT,
  };

  for (let i = 0; i < stages.length; i++) {
    if (stageWritesToProtected(stages[i]!.text, directories[i]!, probe, collectWriteTargets)) {
      return true;
    }
  }
  return false;
}
