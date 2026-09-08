import { isAbsolute, normalize, resolve } from "path";
import { homedir } from "os";

/**
 * Shell directory-set tracking for Bash PreToolUse safety.
 *
 * Agents may `cd` mid-command. Relative write targets must be checked against
 * every directory the shell could still be in after `;` / `&&` / `||` / newlines,
 * and must fail closed when the directory is missing or unresolvable.
 */

export const UNKNOWN_DIRECTORY = Symbol("unknown-shell-directory");
export type ShellDirectory = string | null | typeof UNKNOWN_DIRECTORY;
export type DirectorySet = Set<ShellDirectory>;

export type StageOperator = "start" | ";" | "\n" | "&&" | "||";

export interface ShellStage {
  operator: StageOperator;
  text: string;
}

/** Only a non-empty absolute path is a usable agent cwd. */
export function policyCwd(value: unknown): string | null {
  if (typeof value !== "string" || !value || !isAbsolute(value)) return null;
  return resolve(value);
}

export function isProtectedRelativeCandidate(filePath: string, protectedSegment: string): boolean {
  if (isAbsolute(filePath) || filePath.startsWith("~/") || filePath === "~") return false;
  return normalize(filePath)
    .split("/")
    .some((segment) => segment === protectedSegment);
}

/**
 * Quote-aware split of a shell string into stages joined by `;`, newlines, `&&`, `||`.
 * Pipes stay inside a stage (they do not change the parent's cwd).
 */
export function splitShellStages(command: string): ShellStage[] {
  const stages: ShellStage[] = [];
  let current = "";
  let operator: StageOperator = "start";
  let i = 0;
  let quote: "'" | '"' | null = null;

  const push = () => {
    const text = current.trim();
    if (text) stages.push({ operator, text });
    current = "";
  };

  while (i < command.length) {
    const ch = command[i]!;
    const next = command[i + 1];

    if (quote) {
      current += ch;
      if (ch === "\\" && quote === '"' && i + 1 < command.length) {
        current += command[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      i++;
      continue;
    }

    if (ch === "\\" && i + 1 < command.length) {
      current += ch + command[i + 1]!;
      i += 2;
      continue;
    }

    if (ch === "&" && next === "&") {
      push();
      operator = "&&";
      i += 2;
      continue;
    }
    if (ch === "|" && next === "|") {
      push();
      operator = "||";
      i += 2;
      continue;
    }
    if (ch === ";") {
      push();
      operator = ";";
      i++;
      continue;
    }
    if (ch === "\n") {
      push();
      operator = "\n";
      i++;
      continue;
    }

    current += ch;
    i++;
  }
  push();
  return stages;
}

function stripOuterQuotes(token: string): string {
  if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
    return token.slice(1, -1);
  }
  return token;
}

function tokenizeStage(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      current += ch;
      if (ch === "\\" && quote === '"' && i + 1 < text.length) {
        current += text[++i]!;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    if (ch === ">" || ch === "<") {
      if (current) {
        tokens.push(current);
        current = "";
      }
      if (ch === ">" && text[i + 1] === ">") {
        tokens.push(">>");
        i++;
      } else {
        tokens.push(ch);
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function commandName(token: string | undefined): string {
  if (!token) return "";
  return stripOuterQuotes(token).replace(/^.*\//, "");
}

function isDynamicCdTarget(raw: string | undefined): boolean {
  if (!raw) return true;
  const target = stripOuterQuotes(raw);
  if (!target || target === "-") return true;
  if (target.includes("*") || target.includes("?") || target.includes("[")) return true;
  if (target.includes("$") || target.includes("`")) return true;
  return false;
}

/** Resolve ~ / absolute / relative paths. Relative paths need a known string cwd. */
export function resolveShellPath(filePath: string, cwd: ShellDirectory): string | null {
  const unquoted = stripOuterQuotes(filePath);
  if (!unquoted) return null;
  if (unquoted === "~") return homedir();
  if (unquoted.startsWith("~/")) return resolve(homedir(), unquoted.slice(2));
  if (isAbsolute(unquoted)) return resolve(unquoted);
  if (typeof cwd !== "string") return null;
  return resolve(cwd, unquoted);
}

function cdDestination(stageText: string): "none" | "unknown" | string {
  // Only look at the first pipeline segment — `cd x | ...` still cds in the parent.
  const head = stageText.split(/\|(?!\|)/)[0] ?? stageText;
  const tokens = tokenizeStage(head);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!)) i++;
  const name = commandName(tokens[i]);
  if (name === "pushd" || name === "popd") return "unknown";
  if (name !== "cd") return "none";
  const args = tokens.slice(i + 1).filter((t) => !t.startsWith("-") || t === "-");
  if (args.length === 0) return homedir();
  const target = args[0];
  if (isDynamicCdTarget(target)) return "unknown";
  return stripOuterQuotes(target!);
}

function applyCd(directories: DirectorySet, destination: "none" | "unknown" | string): DirectorySet {
  if (destination === "none") return directories;
  if (destination === "unknown") return new Set([UNKNOWN_DIRECTORY]);
  const next = new Set<ShellDirectory>();
  for (const directory of directories) {
    next.add(resolveShellPath(destination, directory) ?? UNKNOWN_DIRECTORY);
  }
  // Literal absolute / ~/ cd establishes a directory even when the envelope cwd is missing.
  if ([...next].every((d) => d === null || d === UNKNOWN_DIRECTORY)) {
    const absolute = resolveShellPath(destination, null);
    if (absolute) return new Set([absolute]);
  }
  return next;
}

function unionSets(...sets: DirectorySet[]): DirectorySet {
  return new Set(sets.flatMap((set) => [...set]));
}

/**
 * Directory set active for each stage's write checks (the set *before* that
 * stage's own cd takes effect).
 */
export function directoriesForStages(stages: ShellStage[], initialCwd: unknown): DirectorySet[] {
  let success: DirectorySet = new Set([policyCwd(initialCwd)]);
  let failure: DirectorySet = new Set([policyCwd(initialCwd)]);
  const perStage: DirectorySet[] = [];

  for (const stage of stages) {
    let active: DirectorySet;
    switch (stage.operator) {
      case "start":
      case "&&":
        active = success;
        break;
      case "||":
        active = failure;
        break;
      case ";":
      case "\n":
        active = unionSets(success, failure);
        break;
    }
    perStage.push(active);

    const destination = cdDestination(stage.text);
    const afterSuccess = applyCd(active, destination);
    const afterFailure = active; // failed cd keeps the prior directory

    switch (stage.operator) {
      case "start":
      case "&&":
        success = afterSuccess;
        failure = afterFailure;
        break;
      case "||":
        success = afterSuccess;
        failure = afterFailure;
        break;
      case ";":
      case "\n":
        // Both the original (failed cd) and destination (successful cd) remain
        // possible for later stages.
        success = afterSuccess;
        failure = unionSets(active, afterSuccess);
        break;
    }
  }

  return perStage;
}

export interface StageWriteProbe {
  /** Return true when this path under this cwd would write into the protected tree. */
  pathWrites: (path: string, cwd: ShellDirectory) => boolean;
  protectedSegment: string;
}

/**
 * True when a stage has a write target that is dangerous under any directory in `directories`.
 */
export function stageWritesToProtected(stageText: string, directories: DirectorySet, probe: StageWriteProbe, collectWriteTargets: (stageText: string) => string[]): boolean {
  const targets = collectWriteTargets(stageText);
  for (const target of targets) {
    const bare = stripOuterQuotes(target);
    for (const directory of directories) {
      if (directory === UNKNOWN_DIRECTORY) {
        if (!isAbsolute(bare) && !bare.startsWith("~")) return true;
        if (probe.pathWrites(target, null)) return true;
        continue;
      }
      if (directory === null) {
        if (isProtectedRelativeCandidate(bare, probe.protectedSegment)) return true;
        if (probe.pathWrites(target, null)) return true;
        continue;
      }
      if (probe.pathWrites(target, directory)) return true;
    }
  }
  return false;
}
