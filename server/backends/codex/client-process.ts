import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { resolveCodexLauncherPath, withBureauCodexHome } from "./native-bin.ts";
import type { JsonRpcLiteClientOptions } from "./client.ts";

// Surfaced verbatim into chat by sendMessage's BackendNotConfiguredError
// handling when the bundled launcher can't be spawned. Since codex now ships
// as a bureau runtime dep, ENOENT here means the install is corrupt, not
// that the user forgot to install something.
export const CODEX_LAUNCH_FAILED_MESSAGE = `Bureau's bundled Codex CLI failed to launch. Run \`bun install\` in the bureau checkout, then \`/clear\` this conversation to retry.`;

// Grace period between SIGTERM and the SIGKILL escalation when closing a codex
// subprocess group. Long enough for a healthy process to flush and exit, short
// enough that a hung mid-turn process is reclaimed promptly.
const CODEX_KILL_GRACE_MS = 2000;

export function spawnCodexAppServer(opts: JsonRpcLiteClientOptions): ChildProcessWithoutNullStreams {
  const codexArgs = [...(opts.args ?? ["app-server", "--listen", "stdio://"]), "-c", "analytics.enabled=false"];
  let bin: string;
  let spawnArgs: string[];
  if (opts.codexBin) {
    bin = opts.codexBin;
    spawnArgs = codexArgs;
  } else {
    // Default: bundled launcher under process.execPath (Bun runs the JS
    // launcher fine; we don't depend on `node` being on PATH). Resolution
    // throws here are translated to a chat-actionable hint via the catch in
    // CodexSession.bootstrap.
    const launcher = resolveCodexLauncherPath();
    bin = process.execPath;
    spawnArgs = [launcher, ...codexArgs];
  }

  // Apply the bureau CODEX_HOME default here so model/list, fork, read,
  // one-shot, and the session bootstrap all spawn with the same effective env.
  // withBureauCodexHome honors a caller-set CODEX_HOME verbatim.
  return spawn(bin, spawnArgs, {
    cwd: opts.cwd,
    env: withBureauCodexHome(opts.env),
    stdio: ["pipe", "pipe", "pipe"],
    // Make the launcher its own process-group leader so close() can signal
    // the launcher and native codex child together. The JS launcher does not
    // reliably forward signals on its own.
    detached: true,
  });
}

export function terminateCodexProcessGroup(child: ChildProcessWithoutNullStreams): ReturnType<typeof setTimeout> | null {
  if (child.pid === undefined || child.killed) {
    return null;
  }
  try {
    child.stdin.end();
  } catch {}
  const pgid = child.pid;
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {}
  const timer = setTimeout(() => {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {}
  }, CODEX_KILL_GRACE_MS);
  timer.unref?.();
  return timer;
}
