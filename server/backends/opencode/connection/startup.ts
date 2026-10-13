import type { ChildProcess } from "node:child_process";

export const OPENCODE_STARTUP_TIMEOUT_MS = 60_000;

export function announcedPort(output: string): number | null {
  const line = output
    .split(/\r?\n/)
    .slice(0, -1)
    .find((value) => /^opencode server listening on http:\/\/127\.0\.0\.1:\d+$/.test(value));
  if (!line) return null;
  const port = Number(line.slice(line.lastIndexOf(":") + 1));
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

export async function waitForStartedServer(child: ChildProcess, output: () => string, password: string, timeoutMs = OPENCODE_STARTUP_TIMEOUT_MS): Promise<number | null> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return null;
    const port = announcedPort(output());
    if (port !== null) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/global/health`, {
          headers: { authorization: `Basic ${btoa(`bureau:${password}`)}` },
          signal: AbortSignal.timeout(Math.max(1, Math.min(500, deadline - performance.now()))),
        });
        const body = (await response.json()) as { healthy?: boolean };
        if (response.ok && body.healthy === true) return port;
      } catch {
        // A starting process can announce its listener before serving requests.
      }
    }
    await Bun.sleep(Math.max(1, Math.min(50, deadline - performance.now())));
  }
  return null;
}
