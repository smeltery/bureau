import { expect, test } from "bun:test";
import type { AppRecord } from "../../../shared/apps.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleAppChatRequest } from "../chat-http.ts";
const app = { name: "board", hostGen: 2, hostLabel: "board-g2" } as AppRecord;
const status = { name: "board", hostGen: 2, appUrl: "https://board.example", agentId: null, sessionExpiresAt: null };
const browser = { kind: "ok", session: { userId: "owner" } } as AuthResult;
function req(query = "?generation=2") {
  return new Request("https://office.example/api/apps/board/manifest" + query);
}
test("manifest requires a visible exact app generation and browser credentials", async () => {
  let reads = 0;
  const metadata = async () => {
    reads++;
    return { title: "Board title", icons: [] };
  };
  const run = (request: Request, auth = browser, visible = true) =>
    handleAppChatRequest(
      request,
      new URL(request.url),
      () => auth,
      () => (visible ? status : null),
      metadata,
      () => app,
    );
  expect((await run(req()))?.headers.get("content-type")).toContain("application/manifest+json");
  expect(await (await run(req()))?.json()).toMatchObject({ id: "/board/", name: "Board title" });
  const before = reads;
  for (const query of ["", "?generation=1", "?generation=2&generation=2"]) expect((await run(req(query)))?.status).toBe(404);
  expect((await run(req(), browser, false))?.status).toBe(404);
  for (const kind of ["loopback", "api"]) expect((await run(req(), { kind } as AuthResult))?.status).toBe(401);
  expect(reads).toBe(before);
});
test("revocation and replacement during metadata reads return no manifest", async () => {
  for (const change of ["access", "generation", "session"] as const) {
    let changed = false;
    const request = req();
    const response = await handleAppChatRequest(
      request,
      new URL(request.url),
      () => (changed && change === "session" ? { kind: "loopback" } : browser),
      () => (changed && change === "access" ? null : status),
      async () => {
        changed = true;
        return { title: "private", icons: [] };
      },
      () => (changed && change === "generation" ? { ...app, hostGen: 3 } : app),
    );
    expect(response?.status).toBe(404);
    expect(await response?.text()).not.toContain("private");
  }
});
