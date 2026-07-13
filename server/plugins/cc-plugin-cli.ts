import { CLAUDE_NATIVE_BIN } from "../agents/session/runtime.ts";

// Installs do git clones (and marketplace adds fetch the repo); lists read
// local caches and finish in <1s but get headroom for cold starts.
export const LIST_TIMEOUT_MS = 60_000;
export const MUTATION_TIMEOUT_MS = 180_000;

export class CCPluginError extends Error {}

let cliChain: Promise<unknown> = Promise.resolve();

/** Run `claude <args>` with all invocations serialized process-wide. */
export function runCli(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const run = async () => {
    const proc = Bun.spawn([CLAUDE_NATIVE_BIN, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });
    const killTimer = setTimeout(() => proc.kill(), timeoutMs);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      return { stdout, stderr, exitCode };
    } finally {
      clearTimeout(killTimer);
    }
  };
  const result = cliChain.then(run, run);
  cliChain = result.catch(() => {});
  return result;
}

/** Reject anything that could read as a CLI flag or shell-ish garbage. Args
 *  are passed as argv (no shell), so this is about flag injection and about
 *  keeping error messages sane, not command injection. */
export function assertSafeCliArg(value: string, what: string): void {
  if (!value || value.length > 300) throw new CCPluginError(`${what} is empty or too long`);
  if (value.startsWith("-")) throw new CCPluginError(`${what} must not start with "-"`);
  if (!/^[A-Za-z0-9@._\/:~-]+$/.test(value)) {
    throw new CCPluginError(`${what} contains unsupported characters`);
  }
}

export function cliFailureMessage(action: string, res: { stdout: string; stderr: string; exitCode: number }): string {
  const detail = (res.stderr.trim() || res.stdout.trim()).split("\n").slice(-4).join("\n");
  return `${action} failed (exit ${res.exitCode})${detail ? `: ${detail}` : ""}`;
}
