import { collectCommands, type ParsedCommand, type ShellWord } from "./shell-words.ts";

export type SafetyMatch = {
  reason: string;
};

const PACKAGE_RUNNERS = new Set(["npx", "bunx", "pnpm", "yarn"]);
const PATTERN_KILL_COMMANDS = new Set(["pkill", "killall", "killall5"]);
const NAME_LOOKUP_COMMANDS = new Set(["pgrep", "pidof"]);
const PID_TARGET = /^(?:\d+|%\d*|\$\$|\$!)$/;

const TUNNEL_COMMANDS = new Set(["cloudflared", "ngrok", "ssh", "tailscale"]);

function directPackageRunnerCommand(command: ParsedCommand): ParsedCommand {
  if (!PACKAGE_RUNNERS.has(command.name)) return command;
  const args = command.args.filter((arg) => arg.text !== "--yes" && arg.text !== "-y");
  const first = args[0]?.text;
  if (!first) return command;
  const name = first.replace(/^@[^/]+\//, "").replace(/^.*\//, "");
  return { name, args: args.slice(1) };
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
