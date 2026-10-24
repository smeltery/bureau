import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";

async function startOffice(home: string) {
  const child = Bun.spawn([process.execPath, new URL("./office-fixture.ts", import.meta.url).pathname], { env: { ...process.env, BUREAU_HOME: home }, stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader();
  const timer = setTimeout(() => child.kill(), 8000);
  let output = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Office fixture exited: ${await new Response(child.stderr).text()}`);
      output += new TextDecoder().decode(chunk.value);
      const match = /^COOKIE_FIXTURE=(.+)$/m.exec(output);
      if (match) return { child, ...JSON.parse(match[1]) } as { child: typeof child; base: string; name: string; raw: string };
    }
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

function websocketHeaders(base: string, cookie: string): Promise<{ status: number; cookies: string[] }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(base + "/ws", {
      headers: { Cookie: cookie, Origin: base, Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" },
    });
    req.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve({ status: response.statusCode!, cookies: response.headers["set-cookie"] ?? [] });
    });
    req.on("response", (response) => {
      response.resume();
      resolve({ status: response.statusCode!, cookies: response.headers["set-cookie"] ?? [] });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("WebSocket handshake timed out")));
    req.end();
  });
}

test("two real offices migrate HTTP and WebSocket sessions and sign out independently", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-cookie-offices-"));
  const offices: Awaited<ReturnType<typeof startOffice>>[] = [];
  try {
    const a = await startOffice(join(root, "a"));
    offices.push(a);
    const b = await startOffice(join(root, "b"));
    offices.push(b);
    expect(a.name).not.toBe(b.name);
    const jar = new Map<string, string>([
      ["bureau_session", a.raw],
      ["__Host-bureau_session", b.raw],
    ]);
    const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const absorb = (lines: string[]) => {
      for (const line of lines) {
        const pair = line.split(";")[0];
        const at = pair.indexOf("=");
        const name = pair.slice(0, at);
        if (line.includes("Max-Age=0")) jar.delete(name);
        else jar.set(name, pair.slice(at + 1));
      }
    };
    const page = (base: string) => fetch(base + "/", { headers: { Cookie: cookie() }, redirect: "manual" });
    const first = await page(a.base);
    expect([200, 404]).toContain(first.status);
    absorb(first.headers.getSetCookie());
    expect(jar.get(a.name)).toBe(a.raw);
    expect(jar.get("bureau_session")).toBe(a.raw);
    absorb((await page(a.base)).headers.getSetCookie());
    expect(jar.has("bureau_session")).toBe(false);
    expect(jar.get("__Host-bureau_session")).toBe(b.raw);
    jar.set("bureau_session", b.raw);
    const handshake = await websocketHeaders(b.base, cookie());
    expect(handshake.status).toBe(101);
    absorb(handshake.cookies);
    expect(jar.get(b.name)).toBe(b.raw);
    expect((await websocketHeaders(a.base, cookie())).status).toBe(101);
    expect((await page(a.base)).headers.getSetCookie()).toEqual([]);
    const logout = await fetch(a.base + "/auth/logout", { method: "POST", redirect: "manual", headers: { Origin: a.base, Cookie: cookie() } });
    expect(logout.status).toBe(302);
    absorb(logout.headers.getSetCookie());
    expect(jar.get(b.name)).toBe(b.raw);
    expect(jar.get("bureau_session")).toBe(b.raw);
    expect((await page(a.base)).status).toBe(401);
    expect((await websocketHeaders(a.base, cookie())).status).toBe(401);
    expect((await websocketHeaders(b.base, cookie())).status).toBe(101);
  } finally {
    for (const { child } of offices) child.kill();
    await Promise.all(offices.map(({ child }) => child.exited));

    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
