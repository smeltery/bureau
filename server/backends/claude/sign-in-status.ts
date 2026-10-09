import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { CLAUDE_NATIVE_BIN } from "../../agents/session/claude-native.ts";
import { isClaudeCodeAuthenticated } from "../claude-install-check.ts";

type Environment = Record<string, string | undefined>;
export type ClaudeSignInStatus = "signed_in" | "signed_out" | "unknown";

export function parseClaudeAuthStatus(code: number | null, stdout: string, killed = false): ClaudeSignInStatus {
  if (killed) return "unknown";
  try {
    const body = JSON.parse(stdout);
    if (code === 0 && body?.loggedIn === true) return "signed_in";
    if (code === 1 && body?.loggedIn === false) return "signed_out";
  } catch {
    // Unexpected output is not evidence that credentials are missing.
  }
  return "unknown";
}

export function runClaudeAuthStatus(env: Environment, executable = CLAUDE_NATIVE_BIN, timeout = 10_000): Promise<ClaudeSignInStatus> {
  return new Promise((resolve) => {
    execFile(executable, ["auth", "status"], { cwd: homedir(), env, timeout, killSignal: "SIGKILL", maxBuffer: 64 * 1024 }, (error, stdout) => {
      const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
      resolve(parseClaudeAuthStatus(code, stdout, error?.killed));
    });
  });
}

/** File credentials are only a fallback on macOS; ask the bundled CLI about Keychain. */
export function createClaudeSignInProbe({ platform = process.platform, now = Date.now, run = runClaudeAuthStatus } = {}) {
  const cache = new Map<string, { promise: Promise<ClaudeSignInStatus>; expires: number }>();
  return (env: Environment = process.env, refresh = false): Promise<ClaudeSignInStatus> => {
    if (isClaudeCodeAuthenticated(env)) return Promise.resolve("signed_in");
    if (platform !== "darwin") return Promise.resolve("signed_out");
    // Hash the full effective environment so different credentials never share a
    // result, without retaining raw secrets in cache keys.
    const key = createHash("sha256")
      .update(
        JSON.stringify(
          Object.entries(env)
            .filter(([, value]) => value !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      )
      .digest("hex");
    for (const [id, entry] of cache) if (entry.expires <= now()) cache.delete(id);
    const cached = cache.get(key);
    if (cached && (!refresh || cached.expires === Infinity)) return cached.promise;
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    const entry = { expires: Infinity, promise: Promise.resolve("unknown" as ClaudeSignInStatus) };
    entry.promise = Promise.resolve()
      .then(() => run(env))
      .catch(() => "unknown" as const)
      .then((status) => {
        entry.expires = status === "unknown" ? 0 : now() + 15_000;
        return status;
      });
    cache.set(key, entry);
    return entry.promise;
  };
}

export const claudeSignInStatus = createClaudeSignInProbe();
