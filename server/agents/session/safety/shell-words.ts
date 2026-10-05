// A small, quote-aware reading of a shell line into the commands it runs.
// It is a guardrail parser, not a shell: it recognizes the forms agents
// actually write (lists, pipelines, subshells, substitutions, `sh -c`,
// `eval`, wrappers) so a policy can judge each command separately.

export type ShellWord = {
  text: string;
  quoted: boolean;
};

export type ParsedCommand = {
  name: string;
  args: ShellWord[];
};

const MAX_DEPTH = 4;
const SHELL_COMMANDS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const COMMAND_WRAPPERS = new Set(["command", "exec", "nohup", "setsid", "time", "builtin", "if", "while", "until", "do", "then", "else", "elif", "!", "{"]);
const WRAPPER_FLAGS_WITH_VALUE = new Map([
  ["sudo", new Set(["-u", "-g", "-h", "-p", "-C", "-D"])],
  ["env", new Set(["-u", "-S"])],
  ["timeout", new Set(["-s", "--signal", "-k", "--kill-after"])],
  ["xargs", new Set(["-I", "-i", "-n", "-P", "-s", "-E"])],
]);

const ANSI_C_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', e: "\x1b", a: "\x07", b: "\b", f: "\f", v: "\v" };

// Index of the `)` closing the `(` at `open`, skipping quoted text.
function matchParen(line: string, open: number): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = open; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\\") i++;
    else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return line.length;
}

// Splits a line into list/pipeline parts. `$(...)`, `<(...)`, `>(...)` and
// backtick bodies (also inside double quotes) go to `nested` and leave a
// placeholder word behind, so the part keeps its shape.
function splitCommandList(line: string, nested: string[]): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | "$'" | null = null;
  const flush = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote === "'") {
      current += ch;
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === "\\") {
      current += ch + (line[i + 1] ?? "");
      i++;
      continue;
    }
    if (quote === "$'") {
      current += ch;
      if (ch === "'") quote = null;
      continue;
    }
    const opensSubstitution = line[i + 1] === "(" && (ch === "$" || (!quote && (ch === "<" || ch === ">")));
    if (opensSubstitution) {
      const close = matchParen(line, i + 1);
      nested.push(line.slice(i + 2, close));
      current += "_";
      i = close;
      continue;
    }
    if (ch === "`") {
      let close = i + 1;
      while (close < line.length && line[close] !== "`") close += line[close] === "\\" ? 2 : 1;
      nested.push(line.slice(i + 1, close));
      current += "_";
      i = close;
      continue;
    }
    if (quote === '"') {
      current += ch;
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === "$" && line[i + 1] === "'") {
      quote = "$'";
      current += "$'";
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (";|&\n()".includes(ch)) {
      flush();
      continue;
    }
    current += ch;
  }

  flush();
  return parts;
}

// Words with quotes and escapes resolved. A quoted word keeps any whitespace
// inside it, so a policy can tell one opaque argument from several words.
function splitWords(part: string): ShellWord[] {
  const words: ShellWord[] = [];
  let text = "";
  let quote: "'" | '"' | "$'" | null = null;
  let quoted = false;

  const pushWord = () => {
    if (!text && !quoted) return;
    words.push({ text, quoted });
    text = "";
    quoted = false;
  };

  for (let i = 0; i < part.length; i++) {
    const ch = part[i]!;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else text += ch;
      continue;
    }
    if (quote === "$'") {
      if (ch === "'") quote = null;
      else if (ch === "\\") {
        const next = part[++i] ?? "";
        text += ANSI_C_ESCAPES[next] ?? next;
      } else text += ch;
      continue;
    }
    if (ch === "\\") {
      const next = part[++i] ?? "";
      // Inside double quotes a backslash only escapes $ ` " \ and newline.
      if (quote === '"' && !'$`"\\\n'.includes(next)) text += "\\";
      text += next;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else text += ch;
      continue;
    }
    if (ch === "$" && part[i + 1] === "'") {
      quote = "$'";
      quoted = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      quoted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      pushWord();
      continue;
    }
    text += ch;
  }

  pushWord();
  return words;
}

function commandCandidates(words: ShellWord[]): ParsedCommand[] {
  const found: ParsedCommand[] = [];

  for (let i = 0; i < words.length; i++) {
    const raw = words[i]!.text;
    if (!raw || /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) continue;

    const flagsWithValue = WRAPPER_FLAGS_WITH_VALUE.get(raw);
    if (flagsWithValue) {
      i++;
      for (; i < words.length; i++) {
        const arg = words[i]!.text;
        if (!arg || arg === "--" || /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) continue;
        if (arg.startsWith("-")) {
          if (flagsWithValue.has(arg)) i++;
          continue;
        }
        i--;
        break;
      }
      continue;
    }

    const name = raw.replace(/^.*\//, "");
    if (!name) continue;
    found.push({ name, args: words.slice(i + 1) });
    if (COMMAND_WRAPPERS.has(name)) continue;
    break;
  }

  return found;
}

// Source text a command hands to another shell: `sh -c '...'` and `eval ...`.
function shellPayloads(command: ParsedCommand): string[] {
  if (command.name === "eval") return command.args.length ? [command.args.map((arg) => arg.text).join(" ")] : [];
  if (!SHELL_COMMANDS.has(command.name)) return [];
  for (let i = 0; i < command.args.length; i++) {
    const arg = command.args[i]!.text;
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(arg)) {
      const payload = command.args[i + 1]?.text;
      return payload ? [payload] : [];
    }
  }
  return [];
}

export function collectCommands(line: string, depth = 0): ParsedCommand[] {
  if (depth > MAX_DEPTH) return [];
  const nested: string[] = [];
  const parsed: ParsedCommand[] = [];
  for (const part of splitCommandList(line, nested)) {
    for (const candidate of commandCandidates(splitWords(part))) {
      parsed.push(candidate);
      for (const payload of shellPayloads(candidate)) parsed.push(...collectCommands(payload, depth + 1));
    }
  }
  for (const body of nested) parsed.push(...collectCommands(body, depth + 1));
  return parsed;
}
