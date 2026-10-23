import { expect, test } from "bun:test";
import type { AuthResult } from "../../../auth/auth-middleware.ts";
import { handleAppChatRequest } from "../../chat-http.ts";

const status = { name: "board", hostGen: 2, appUrl: "https://board-g2.example/", agentId: "agent", sessionExpiresAt: 1000 };
const browser = { kind: "ok", session: { userId: "owner" } } as AuthResult;
async function request(query: string, auth: AuthResult = browser, method = "GET") {
  const req = new Request(`https://office.example/api/apps/board/chat-view${query}`, { method });
  return (await handleAppChatRequest(
    req,
    new URL(req.url),
    () => auth,
    () => status,
  ))!;
}

test("chat metadata requires the exact generation and a browser identity", async () => {
  expect(await (await request("?generation=2")).json()).toEqual(status);
  expect((await request("?generation=2")).headers.get("cache-control")).toBe("no-store");
  for (const query of ["", "?generation=1", "?generation=2&generation=2"]) expect((await request(query)).status).toBe(404);
  for (const kind of ["loopback", "agent", "api"]) expect((await request("?generation=2", { kind } as AuthResult)).status).toBe(401);
  expect((await request("?generation=2", browser, "POST")).status).toBe(404);
});
