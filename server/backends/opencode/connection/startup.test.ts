import { expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { announcedPort, waitForStartedServer } from "./startup.ts";

test("startup only accepts a complete loopback listener announcement", () => {
  expect(announcedPort("opencode server listening on http://127.0.0.1:54321\n")).toBe(54321);
  for (const text of [
    "http://127.0.0.1:5000\n",
    "opencode server listening on http://0.0.0.0:5000\n",
    "opencode server listening on http://127.0.0.1:70000\n",
    "opencode server listening on http://127.0.0.1:5000",
  ])
    expect(announcedPort(text)).toBeNull();
});

test("startup waits for readiness but rejects exited or silent children", async () => {
  let ready = false;
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ healthy: ready }) });
  const child = { pid: process.pid, exitCode: null, signalCode: null } as ChildProcess;
  const announcement = () => `opencode server listening on http://127.0.0.1:${server.port}\n`;
  const timer = setTimeout(() => {
    ready = true;
  }, 60);
  try {
    expect(await waitForStartedServer(child, announcement, "test", 1000)).toBe(server.port!);
    expect(await waitForStartedServer(child, () => "", "test", 20)).toBeNull();
    expect(await waitForStartedServer({ ...child, signalCode: "SIGTERM" } as ChildProcess, announcement, "test", 1000)).toBeNull();
  } finally {
    clearTimeout(timer);
    await server.stop(true);
  }
});
