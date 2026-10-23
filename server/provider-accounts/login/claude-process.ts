import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { SpawnOptions } from "@anthropic-ai/claude-agent-sdk";

/** Keep the directory locked until the credential-writing process has exited. */
export function createClaudeAccountProcess() {
  let child: ChildProcessWithoutNullStreams | null = null;
  let exited: Promise<void> = Promise.resolve();
  let closed = false;
  let closing: Promise<void> | null = null;
  return {
    terminate() {
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL");
        } catch {
          /* Already exited. */
        }
      }
    },
    spawn(options: SpawnOptions) {
      if (closed || child) throw new Error("Account process is closed or already started.");
      child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
      child.stderr.resume();
      exited = new Promise((resolve) => {
        child!.once("close", () => resolve());
      });
      return child;
    },
    close() {
      closed = true;
      closing ??= (async () => {
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        const current = child;
        const kill = (signal: NodeJS.Signals) => {
          try {
            if (process.platform !== "win32" && current.pid) process.kill(-current.pid, signal);
            else current.kill(signal);
          } catch {
            /* The child may have exited between the state check and signal. */
          }
        };
        current.stdin.end();
        kill("SIGTERM");
        const timer = setTimeout(() => kill("SIGKILL"), 2000);
        try {
          await exited;
        } finally {
          clearTimeout(timer);
        }
      })();
      return closing;
    },
  };
}
