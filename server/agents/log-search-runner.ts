import type { LogReadResult } from "./log-reader.ts";

const CHILD_PATH = new URL("./log-search-child.ts", import.meta.url).pathname;
const SEARCH_TIMEOUT_MS = 1000;

type ChildEnvelope = { ok: true; result: LogReadResult } | { ok: false; error: string };

export async function readAgentLogsIsolated(agentId: string, query: URLSearchParams): Promise<LogReadResult> {
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn([process.execPath, "run", CHILD_PATH], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return { ok: false, status: 500, error: "log search failed" };
  }

  const timeout = setTimeout(() => {
    proc.kill("SIGKILL");
  }, SEARCH_TIMEOUT_MS);

  try {
    proc.stdin.write(JSON.stringify({ agentId, query: query.toString() }));
    proc.stdin.end();
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (exitCode !== 0 || stdout.trim() === "") return { ok: false, status: 504, error: "log search timed out" };
    const envelope = JSON.parse(stdout) as ChildEnvelope;
    if (!envelope.ok) return { ok: false, status: 500, error: "log search failed" };
    return envelope.result;
  } catch {
    return { ok: false, status: 500, error: "log search failed" };
  } finally {
    clearTimeout(timeout);
    proc.stderr.cancel().catch(() => {});
  }
}
