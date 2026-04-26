import { homedir } from "os";
import { resolve } from "path";

export const BUREAU_DIR = resolve(homedir(), ".bureau");

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

export function commandWritesToBureau(command: string): boolean {
  // Check 1: Redirection (> or >>) targeting ~/.bureau/
  // Match: > ~/.bureau/ or >> ~/.bureau/ or > /home/user/.bureau/
  const redirectPattern = new RegExp(`>>?\\s*(?:~\\/\\.bureau|${BUREAU_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`);
  if (redirectPattern.test(command)) return true;

  // Check 2: Write commands with ~/.bureau/ as an argument
  // Split on pipe/semicolon/&&/|| to get individual sub-commands
  const subCommands = command.split(/[|;&]+/).map((s) => s.trim());
  for (const sub of subCommands) {
    if (!sub.includes(BUREAU_DIR) && !sub.includes("~/.bureau")) continue;
    const firstToken = sub.split(/\s+/)[0]?.replace(/^.*\//, "") ?? "";
    if (!WRITE_COMMANDS.includes(firstToken)) continue;

    // For copy-like commands, only the destination (last arg) is a write target.
    // Reading *from* ~/.bureau/ is fine — only block if writing *to* it.
    if (COPY_COMMANDS.includes(firstToken)) {
      const args = sub.split(/\s+/).filter((a) => !a.startsWith("-"));
      const dest = args[args.length - 1] ?? "";
      if (dest.includes(BUREAU_DIR) || dest.includes("~/.bureau")) return true;
      continue;
    }

    return true;
  }

  return false;
}
