import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeAuthorityBroker } from "../authority-broker.ts";

// Exercise the real Unix HTTP bridge; deterministic process readers isolate
// route/response tests from host-specific peer credential APIs.
test("office proxy forwards scoped integrations and preserves binary responses", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-proxy-"));
  const socket = join(root, "proxy.sock");
  const token = "test-office-bearer";
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0xfe]);
  const requests: { method: string; path: string; auth: string | null; body: string }[] = [];
  const upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const path = new URL(req.url).pathname;
      requests.push({ method: req.method, path, auth: req.headers.get("authorization"), body: await req.text() });
      if (req.method === "GET" && path.endsWith("thumbnail")) return new Response(image, { headers: { "content-type": "image/png" } });
      return new Response(Buffer.concat([image, Buffer.from(`${token}|${token}`), image]));
    },
  });
  const broker = new OpenCodeAuthorityBroker(socket, 100, `http://127.0.0.1:${upstream.port}`, {
    readPeerCredentials: () => ({ pid: 42, uid: 100 }),
    readProcessHop: (pid) => (pid === 42 ? { pid: 42, parentPid: 1, startTicks: "stable" } : null),
  });
  const binding = broker.bind("agent", token);
  const request = (method: string, path: string, body?: object, handle = binding.handle) =>
    fetch(`http://bureau${path}`, { unix: socket, method, headers: { "x-bureau-turn": handle }, body: body ? JSON.stringify(body) : undefined });
  try {
    expect((await request("GET", "/api/agents/agent/shared-browser")).status).toBe(403);
    binding.activate(42);
    for (const [method, path, body] of [
      ["GET", "/api/agent-reference/browser"],
      ["GET", "/api/agents/agent/shared-browser"],
      ["POST", "/api/agents/agent/shared-browser", { action: "upload", path: "report.txt", selector: "#file" }],
      ["PUT", "/api/apps/report/thumbnail", { path: "image.png" }],
      ["DELETE", "/api/apps/report/thumbnail"],
      ["POST", "/api/apps/report/archive", {}],
      ["POST", "/api/apps/report/restore", {}],
      ["POST", "/api/cronjobs/job/runs/run/read-file", { path: "report.txt" }],
      ["POST", "/api/cronjobs/job/runs/run/diff", {}],
      ["POST", "/api/pager", { title: "Needs attention" }],
      ["POST", "/api/pager/resolve", { key: "alert" }],
    ] as const) {
      const response = await request(method, path, body);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.concat([image, Buffer.from("[REDACTED]|[REDACTED]"), image]));
      expect(requests.at(-1)).toEqual({ method, path, auth: `Bearer ${token}`, body: body ? JSON.stringify(body) : "" });
    }
    const response = await request("GET", "/api/apps/report/thumbnail");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(image);
    const before = requests.length;
    expect((await request("PUT", "/api/pager/settings", {})).status).toBe(403);
    expect((await request("POST", "/api/browser-sharing/pairing", {})).status).toBe(403);
    expect((await request("PUT", "/api/apps/report/thumbnail", { path: "image.png" }, "wrong")).status).toBe(403);
    binding.deactivate();
    expect((await request("GET", "/api/apps/report/thumbnail")).status).toBe(403);
    expect(requests).toHaveLength(before);
  } finally {
    binding.unbind();
    broker.close();
    upstream.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
});
