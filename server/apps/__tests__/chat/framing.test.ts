import { expect, test } from "bun:test";
import { allowOfficeFrame, appFrameNeedsSession } from "../../host/framing.ts";
import { buildPublicOrigin } from "../../../auth/auth.ts";

test("app framing allows only the office while retaining unrelated policies", async () => {
  const headers = new Headers({ "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'; script-src 'self'" });
  allowOfficeFrame(headers);
  expect(headers.has("X-Frame-Options")).toBe(false);
  expect(headers.get("Content-Security-Policy")).toBe(`default-src 'self'; script-src 'self'; frame-ancestors ${buildPublicOrigin().origin}`);
  const response = appFrameNeedsSession();
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toContain(`postMessage("bureau:app-session-required",${JSON.stringify(buildPublicOrigin().origin)})`);
});
