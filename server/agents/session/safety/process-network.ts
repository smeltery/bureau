type ShellWord = {
  text: string;
  quoted: boolean;
};

type ParsedCommand = {
  name: string;
  args: ShellWord[];
};

export type SafetyMatch = {
  reason: string;
};

const SHELL_COMMANDS = new Set(["bash", "sh", "zsh"]);
const COMMAND_WRAPPERS = new Set(["command", "exec", "nohup", "setsid", "time"]);
const PACKAGE_RUNNERS = new Set(["npx", "bunx", "pnpm", "yarn"]);
const PATTERN_KILL_COMMANDS = new Set(["pkill", "killall", "killall5"]);
const NAME_LOOKUP_COMMANDS = new Set(["pgrep", "pidof"]);
const PID_TARGET = /^(?:\d+|%\d*|\$\$|\$!)$/;

const WRAPPER_FLAGS_WITH_VALUE = new Map([
  ["sudo", new Set(["-u", "-g", "-h", "-p", "-C", "-D"])],
  ["env", new Set(["-u", "-S"])],
  ["timeout", new Set(["-s", "--signal", "-k", "--kill-after"])],
  ["xargs", new Set(["-I", "-i", "-n", "-P", "-s", "-E"])],
]);

const TUNNEL_COMMANDS = new Set(["cloudflared", "ngrok", "ssh", "tailscale"]);

function splitCommandList(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const ch of command) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "&" || ch === "\n") {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitWords(command: string): ShellWord[] {
  const words: ShellWord[] = [];
  let text = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let quoted = false;

  function pushWord() {
    if (!text && !quoted) return;
    words.push({ text, quoted });
    text = "";
    quoted = false;
  }

  for (const ch of command) {
    if (escaped) {
      text += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else text += ch;
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
    const raw = words[i].text;
    if (!raw || /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) continue;

    if (raw === "sudo" || raw === "env" || raw === "timeout" || raw === "xargs") {
      const flagsWithValue = WRAPPER_FLAGS_WITH_VALUE.get(raw) ?? new Set<string>();
      i++;
      for (; i < words.length; i++) {
        const arg = words[i].text;
        if (!arg) continue;
        if (arg === "--") continue;
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) continue;
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
    const command = { name, args: words.slice(i + 1) };
    found.push(command);
    if (COMMAND_WRAPPERS.has(name)) continue;
    break;
  }

  return found;
}

function shellPayload(command: ParsedCommand): string | null {
  if (!SHELL_COMMANDS.has(command.name)) return null;
  for (let i = 0; i < command.args.length; i++) {
    const arg = command.args[i].text;
    if (arg === "-c") return command.args[i + 1]?.text ?? null;
    if (arg.startsWith("-") && arg.includes("c") && arg !== "-") return command.args[i + 1]?.text ?? null;
  }
  return null;
}

function directPackageRunnerCommand(command: ParsedCommand): ParsedCommand {
  if (!PACKAGE_RUNNERS.has(command.name)) return command;
  const args = command.args.filter((arg) => arg.text !== "--yes" && arg.text !== "-y");
  const first = args[0]?.text;
  if (!first) return command;
  const name = first.replace(/^@[^/]+\//, "").replace(/^.*\//, "");
  return { name, args: args.slice(1) };
}

function collectCommands(command: string, depth = 0): ParsedCommand[] {
  if (depth > 3) return [];
  const parsed: ParsedCommand[] = [];
  for (const part of splitCommandList(command)) {
    for (const candidate of commandCandidates(splitWords(part))) {
      parsed.push(candidate);
      const payload = shellPayload(candidate);
      if (payload) parsed.push(...collectCommands(payload, depth + 1));
    }
  }
  return parsed;
}

function firstOperandIndex(args: ShellWord[], flagsWithValue: Set<string>): number {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i].text;
    if (arg === "--") return i + 1;
    if (!arg.startsWith("-") || arg === "-") return i;
    if (flagsWithValue.has(arg) || [...flagsWithValue].some((flag) => arg.startsWith(`${flag}=`))) i++;
  }
  return args.length;
}

function tunnelReason(command: ParsedCommand): string | null {
  const cmd = directPackageRunnerCommand(command);
  if (!TUNNEL_COMMANDS.has(cmd.name)) return null;

  if (cmd.name === "cloudflared") {
    const tunnel = cmd.args.findIndex((arg) => arg.text === "tunnel");
    if (tunnel !== -1 && ["run", "--url", "url"].some((token) => cmd.args.slice(tunnel + 1).some((arg) => arg.text === token || arg.text.startsWith(`${token}=`)))) {
      return "Refused: `cloudflared tunnel` (an agent may not open a tunnel).";
    }
  }

  if (cmd.name === "ngrok") {
    const subcommand = cmd.args[firstOperandIndex(cmd.args, new Set(["--config", "--log", "--region"]))]?.text;
    if (["http", "tcp", "tls", "start"].includes(subcommand ?? "")) return "Refused: `ngrok` (an agent may not open a tunnel).";
  }

  if (cmd.name === "ssh") {
    for (let i = 0; i < cmd.args.length; i++) {
      const arg = cmd.args[i].text;
      if (arg === "-R" || arg === "-L" || arg === "-D") return `Refused: \`ssh ${arg}\` (an agent may not open a tunnel).`;
      if (/^-[^-]*[RLD]/.test(arg)) return "Refused: `ssh` port forwarding (an agent may not open a tunnel).";
    }
  }

  if (cmd.name === "tailscale") {
    const subcommand = cmd.args[firstOperandIndex(cmd.args, new Set(["--socket", "--state"]))]?.text;
    if (subcommand === "funnel" || subcommand === "serve") return "Refused: `tailscale funnel/serve` (an agent may not open a tunnel).";
  }

  return null;
}

function nameKillReason(command: ParsedCommand): string | null {
  const cmd = command;
  if (PATTERN_KILL_COMMANDS.has(cmd.name)) {
    if (cmd.name === "pkill" && cmd.args.some((arg, index) => arg.text === "-P" && PID_TARGET.test(cmd.args[index + 1]?.text ?? ""))) return null;
    if (cmd.args.some((arg) => !arg.text.startsWith("-") && !PID_TARGET.test(arg.text)))
      return `Refused: \`${cmd.name}\` by name can kill bureau or other agent processes. Use a PID-scoped command instead.`;
    if (cmd.args.some((arg) => arg.text === "-f")) return `Refused: \`${cmd.name} -f\` can kill bureau or other agent processes. Use a PID-scoped command instead.`;
  }

  if (NAME_LOOKUP_COMMANDS.has(cmd.name) && cmd.args.some((arg) => !arg.text.startsWith("-") && !PID_TARGET.test(arg.text))) {
    return `Refused: \`${cmd.name}\` by name can be used to target bureau or other agent processes. Use a PID-scoped command instead.`;
  }

  return null;
}

export function checkProcessNetworkSafety(command: string): SafetyMatch | null {
  for (const parsed of collectCommands(command)) {
    const kill = nameKillReason(parsed);
    if (kill) return { reason: kill };
    const tunnel = tunnelReason(parsed);
    if (tunnel) return { reason: `${tunnel} This text check covers recognized command forms only; a renamed binary or indirect service start can still bypass it.` };
  }
  return null;
}
