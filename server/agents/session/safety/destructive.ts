import { DESTRUCTIVE_PATTERNS, SAFE_PATTERNS } from "./patterns.ts";
import { collectCommands, type ParsedCommand, type ShellWord } from "./shell-words.ts";

// Patterns and exceptions match from the start of the command that runs, so an
// operand (`git reset --hard x git checkout -b y`) cannot supply an exception.
const anchored = (pattern: RegExp) => new RegExp(`^(?:${pattern.source})`, pattern.flags);
const DESTRUCTIVE = DESTRUCTIVE_PATTERNS.map(([pattern, reason]) => [anchored(pattern), reason] as const);
const SAFE = SAFE_PATTERNS.map(anchored);

const GIT_GLOBAL_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--attr-source", "--super-prefix"]);

// `git -C repo -c a=b reset --hard` is `git reset --hard`: global options and
// their values are dropped up to the subcommand.
function withoutGitGlobalOptions(command: ParsedCommand): ParsedCommand {
  if (command.name !== "git") return command;
  let i = 0;
  while (i < command.args.length && command.args[i]!.text.startsWith("-")) {
    i += GIT_GLOBAL_VALUE_OPTIONS.has(command.args[i]!.text) ? 2 : 1;
  }
  return { name: "git", args: command.args.slice(i) };
}

// A word that holds whitespace is one opaque argument (a commit message, an
// echo string), never command structure.
function patternText(command: ParsedCommand): string {
  return [command.name, ...command.args.map((word) => (/\s/.test(word.text) ? "_" : word.text))].join(" ");
}

function rmOperands(args: ShellWord[]): ShellWord[] {
  const end = args.findIndex((word) => word.text === "--");
  const flagged = end === -1 ? args : args.slice(0, end);
  const operands = flagged.filter((word) => !word.text.startsWith("-"));
  return end === -1 ? operands : [...operands, ...args.slice(end + 1)];
}

// One entry directly in /tmp or /var/tmp, as written. The policy does not
// stat, so a deeper path could pass through a symlink the same line creates.
function isTempEntry(word: ShellWord): boolean {
  const match = /^\/(?:var\/)?tmp\/([^/]+)\/?$/.exec(word.text);
  return !!match && match[1] !== "." && match[1] !== "..";
}

export function destructiveReason(line: string): string | null {
  for (const parsed of collectCommands(line)) {
    const command = withoutGitGlobalOptions(parsed);
    const text = patternText(command);
    if (SAFE.some((pattern) => pattern.test(text))) continue;
    const match = DESTRUCTIVE.find(([pattern]) => pattern.test(text));
    if (!match) continue;
    if (command.name === "rm") {
      const operands = rmOperands(command.args);
      if (operands.length > 0 && operands.every(isTempEntry)) continue;
    }
    return match[1];
  }
  return null;
}
