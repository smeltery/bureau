import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeAuthorityBroker } from "../authority-broker.ts";

test("the Unix bridge preserves large binary requests and drains large responses", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-binary-proxy-"));
  const socket = join(root, "proxy.sock");
  const body = new Uint8Array(1024 * 1024);
  for (let i = 0; i < body.length; i++) body[i] = i % 256;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      expect(req.headers.get("content-type")).toBe("image/png");
      expect(req.headers.get("authorization")).toBe("Bearer test-bearer");
      expect(req.headers.get("cookie")).toBeNull();
      expect(new Uint8Array(await req.arrayBuffer())).toEqual(body);
      return new Response(body, { headers: { "content-type": "image/png" } });
    },
  });
  const broker = new OpenCodeAuthorityBroker(socket, 100, `http://127.0.0.1:${server.port}`, {
    readPeerCredentials: () => ({ pid: 42, uid: 100 }),
    readProcessHop: (pid) => (pid === 42 ? { pid: 42, parentPid: 1, startTicks: "stable" } : null),
  });
  const binding = broker.bind("agent", "test-bearer");
  binding.activate(42);
  try {
    const response = await fetch("http://bureau/api/apps/report/thumbnail", {
      unix: socket,
      method: "PUT",
      body,
      headers: { "x-bureau-turn": binding.handle, "content-type": "image/png", cookie: "not-forwarded", expect: "100-continue" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);
  } finally {
    binding.unbind();
    broker.close();
    await server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
});
