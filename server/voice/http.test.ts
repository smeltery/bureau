import { expect, test } from "bun:test";
import type { AuthResult } from "../auth/auth-middleware.ts";
import type { UserRecord } from "../../shared/types.ts";
import { createVoiceHandler } from "./http.ts";
const browser = { kind: "ok", session: { userId: "member" } } as AuthResult;
const credential = { key: "private-key", keyName: "OPENAI_VOICE_API_KEY", keySource: "member" as const, available: true };
function fixture() {
  let calls = 0;
  let current = browser;
  const user = { id: "member", voiceName: "cedar" } as UserRecord;
  const deps = {
    credential: () => credential,
    getUser: () => user,
    transcribe: async () => {
      calls++;
      return "dictated";
    },
    speak: async () => {
      calls++;
      return new Uint8Array([1, 2]);
    },
  };
  const handler = createVoiceHandler(deps);
  const run = (path: string, options?: RequestInit) => {
    const req = new Request(`https://office.example/api/voice${path}`, options);
    return handler(req, new URL(req.url), () => current);
  };
  return {
    deps,
    run,
    auth: (auth: AuthResult) => {
      current = auth;
    },
    calls: () => calls,
  };
}
const audio = () => ({ method: "POST", headers: { "Content-Type": "audio/webm;codecs=opus" }, body: "clip" });
test("voice status never reveals keys and spending requires a current browser session", async () => {
  const f = fixture();
  const status = await f.run("");
  expect(await status!.json()).toEqual({ keyName: credential.keyName, keySource: "member", available: true });
  expect(status!.headers.get("cache-control")).toBe("no-store");
  for (const kind of ["loopback", "api", "rejected"]) {
    f.auth({ kind } as AuthResult);
    expect((await f.run("/transcribe", audio()))!.status).toBe(401);
  }
  f.auth(browser);
  expect((await f.run("/transcribe", { ...audio(), headers: { ...audio().headers, authorization: "Bearer other" } }))!.status).toBe(401);
  expect(f.calls()).toBe(0);
  f.deps.getUser = () => null as unknown as UserRecord;
  expect((await f.run(""))!.status).toBe(401);
});
test("voice validates bodies, limits upload bytes and forwards only valid requests", async () => {
  const f = fixture();
  expect((await f.run("/transcribe", { ...audio(), headers: { "Content-Type": "text/plain" } }))!.status).toBe(415);
  for (const body of ["null", "[]", "{", JSON.stringify({ text: "a".repeat(4097) }), JSON.stringify({ text: "hello", voice: "invalid" })]) {
    expect((await f.run("/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body }))!.status).toBe(400);
  }
  expect((await f.run("/transcribe", { ...audio(), body: new Uint8Array(25 * 1024 * 1024 + 1) }))!.status).toBe(413);
  expect(f.calls()).toBe(0);
  expect(await (await f.run("/transcribe", audio()))!.json()).toEqual({ text: "dictated" });
  expect((await f.run("/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hello" }) }))!.headers.get("content-type")).toBe("audio/wav");
});
test("voice rechecks sessions after upload and before returning private output", async () => {
  const f = fixture();
  const body = new ReadableStream({
    async pull(controller) {
      await Bun.sleep(0);
      f.auth({ kind: "loopback" });
      controller.enqueue(new TextEncoder().encode("clip"));
      controller.close();
    },
  });
  expect((await f.run("/transcribe", { ...audio(), body }))!.status).toBe(401);
  expect(f.calls()).toBe(0);
  f.auth(browser);
  f.deps.transcribe = async () => {
    f.auth({ kind: "loopback" });
    return "private transcript";
  };
  const response = await f.run("/transcribe", audio());
  expect(response!.status).toBe(401);
  expect(await response!.text()).not.toContain("private transcript");
});
test("voice serializes member requests and releases capacity after failure", async () => {
  const f = fixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.deps.transcribe = async () => {
    await pending;
    throw new Error("private-key provider error");
  };
  const first = f.run("/transcribe", audio());
  await Bun.sleep(0);
  expect((await f.run("/transcribe", audio()))!.status).toBe(429);
  release();
  expect(await (await first)!.text()).not.toContain("private-key");
  f.deps.transcribe = async () => "recovered";
  expect((await f.run("/transcribe", audio()))!.status).toBe(200);
});
