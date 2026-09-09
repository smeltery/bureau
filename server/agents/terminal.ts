import { homedir, userInfo } from "os";
import { join } from "path";
import { readEnvFile } from "../persistence.ts";
import { getUserById } from "../users.ts";
import { agents, emit, officeConfig, rooms, type ManagedAgent } from "./state.ts";
import { createTerminalFinalizer } from "./terminal-finalizer.ts";

// --- Terminal PTY management (via Node.js sidecar) ---

const PTY_SIDECAR_PATH = join(import.meta.dir, "pty-sidecar.cjs");
const MAX_PTY_BUFFER = 100_000;

export function sidecarSend(managed: ManagedAgent, msg: Record<string, unknown>) {
  const stdin = managed.ptySidecar?.stdin;
  if (stdin && typeof stdin !== "number") stdin.write(JSON.stringify(msg) + "\n");
}

export function openTerminal(agentId: string): boolean {
  const managed = agents.get(agentId);
  if (!managed) return false;

  // Already running — just replay buffered output
  if (managed.ptySidecar) return true;

  let managedEnv: Record<string, string | undefined>;
  try {
    managedEnv = buildTerminalEnv(managed);
  } catch (err) {
    console.warn(`[terminal] cannot open PTY for ${agentId}:`, err);
    emit({ type: "terminal_exit", agentId, exitCode: 1 });
    return false;
  }

  const shell = process.env.SHELL || "/bin/bash";
  const home = homedir();
  const ptyEnv: Record<string, string> = {
    ...(managedEnv as Record<string, string>),
    TERM: "xterm-256color",
    SHELL: shell,
    HOME: home,
    USER: process.env.USER || userInfo().username,
    LANG: process.env.LANG || "en_US.UTF-8",
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
  };

  const sidecar = Bun.spawn(["node", PTY_SIDECAR_PATH], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });

  managed.ptySidecar = sidecar;
  managed.ptyBuffer = "";

  const finalize = createTerminalFinalizer({
    isCurrent: () => managed.ptySidecar === sidecar,
    detach: () => {
      managed.ptySidecar = null;
    },
    emitExit: (exitCode) => emit({ type: "terminal_exit", agentId, exitCode }),
  });

  // Read stdout as text lines using Bun's native ReadableStream
  (async () => {
    const reader = sidecar.stdout.getReader();
    const decoder = new TextDecoder();
    let partial = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        partial += decoder.decode(value, { stream: true });
        const lines = partial.split("\n");
        partial = lines.pop()!; // keep incomplete last line
        for (const line of lines) {
          if (!line) continue;
          let msg: any;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.type === "output") {
            if (managed.ptySidecar !== sidecar) continue;
            managed.ptyBuffer += msg.data;
            if (managed.ptyBuffer.length > MAX_PTY_BUFFER) {
              managed.ptyBuffer = managed.ptyBuffer.slice(-MAX_PTY_BUFFER);
            }
            emit({ type: "terminal_output", agentId, data: msg.data });
          } else if (msg.type === "exit") {
            console.log(`[terminal] PTY exited for ${agentId}: code=${msg.exitCode}, signal=${msg.signal}`);
            finalize(typeof msg.exitCode === "number" ? msg.exitCode : 0);
          }
        }
      }
    } catch {}
  })();

  sidecar.exited.then((exitCode) => finalize(exitCode));

  // Tell sidecar to spawn the PTY
  sidecarSend(managed, {
    type: "spawn",
    shell,
    cols: 80,
    rows: 24,
    cwd: managed.info.cwd,
    env: ptyEnv,
  });

  console.log(`[terminal] Spawned sidecar for ${agentId}: shell=${shell}, cwd=${managed.info.cwd}, pid=${sidecar.pid}`);
  return true;
}

function buildTerminalEnv(managed: ManagedAgent): Record<string, string | undefined> {
  const roomEnvFile = rooms[managed.info.room]?.envFile ?? null;
  const userEnvFile = managed.info.userId ? (getUserById(managed.info.userId)?.envFile ?? null) : null;
  const merged: Record<string, string | undefined> = { ...process.env };
  if (officeConfig.envFile) Object.assign(merged, readEnvFile(officeConfig.envFile));
  if (roomEnvFile) Object.assign(merged, readEnvFile(roomEnvFile));
  if (userEnvFile) Object.assign(merged, readEnvFile(userEnvFile));
  return merged;
}

export function getTerminalBuffer(agentId: string): string | null {
  const managed = agents.get(agentId);
  if (!managed?.ptySidecar) return null;
  return managed.ptyBuffer;
}

export function terminalInput(agentId: string, data: string) {
  const managed = agents.get(agentId);
  if (managed?.ptySidecar) sidecarSend(managed, { type: "input", data });
}

export function terminalResize(agentId: string, cols: number, rows: number) {
  const managed = agents.get(agentId);
  if (managed?.ptySidecar) sidecarSend(managed, { type: "resize", cols, rows });
}

export function closeTerminal(agentId: string) {
  const managed = agents.get(agentId);
  if (!managed?.ptySidecar) return;
  sidecarSend(managed, { type: "kill" });
  managed.ptySidecar = null;
  managed.ptyBuffer = "";
}
