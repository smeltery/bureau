import { expect, test } from "bun:test";
import { requiresBrowserSession } from "./browser-management.ts";

test("local settings requests retain browser identity while explicit operators keep bearer routing", () => {
  for (const path of ["/api/integrations/office", "/api/me/provider-accounts", "/api/office/settings"]) {
    const request = new Request(`http://localhost:4000${path}`);
    expect(requiresBrowserSession(request, new URL(request.url))).toBe(true);
    const operator = new Request(request, { headers: { authorization: "Bearer test-operator" } });
    expect(requiresBrowserSession(operator, new URL(operator.url))).toBe(false);
  }
});
