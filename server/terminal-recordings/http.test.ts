import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("recording routes require a current browser owner and protect live files", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-recording-http-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { handleRecordingRequest } from "./server/terminal-recordings/http.ts";
      import { startRecording, recordingEnabled } from "./server/terminal-recordings/store.ts";
      import { claimUserByName, setUserRoleById } from "./server/users.ts";
      import { requiresBrowserSession } from "./server/http/routing/browser-management.ts";
      const owner = claimUserByName("recording owner", { role: "owner" });
      claimUserByName("other owner", { role: "owner" });
      const member = claimUserByName("recording member", { role: "member" });
      const auth = user => ({ kind: "ok", session: { userId: user.id, role: user.role } });
      const request = (suffix = "", method = "GET", body, identity = auth(owner), headers = {}) => {
        const url = new URL("http://localhost/api/terminal-recordings" + suffix);
        const req = new Request(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        expect(requiresBrowserSession(req, url)).toBe(true);
        return handleRecordingRequest(req, url, identity);
      };
      expect((await request("", "GET", undefined, { kind: "loopback" })).status).toBe(401);
      expect((await request("", "GET", undefined, { kind: "api", token: { role: "owner" } })).status).toBe(401);
      expect((await request("", "GET", undefined, auth(owner), { authorization: "Bearer any" })).status).toBe(401);
      expect((await request("", "GET", undefined, auth(member))).status).toBe(403);
      expect((await request("/settings", "PATCH", { enabled: "yes" })).status).toBe(400);
      expect((await request("/settings", "PATCH", { enabled: true })).status).toBe(200);
      const recording = startRecording("agent", "room", () => {});
      expect((await request("/" + recording.id, "DELETE")).status).toBe(409);
      recording.output("hello\\n"); recording.close("closed");
      expect((await (await request("/" + recording.id)).json()).events[0].data).toBe("hello\\n");
      expect((await (await request()).json()).recordings).toHaveLength(1);
      expect((await request("/" + recording.id, "DELETE")).status).toBe(200);
      expect((await request("/" + recording.id)).status).toBe(404);
      const pending = request("/settings", "PATCH", { enabled: false });
      setUserRoleById(owner.id, "member");
      expect((await pending).status).toBe(403);
      expect(recordingEnabled()).toBe(true);
      expect((await request("/settings")).status).toBe(403);
      process.exit(0);
    `,
      ],
      { env: { ...process.env, BUREAU_HOME: root }, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
