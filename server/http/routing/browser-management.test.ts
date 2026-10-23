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

test("owner storage and personal inbox routes always retain browser identity", () => {
  for (const path of [
    "/api/storage/usage",
    "/api/storage/compress",
    "/api/storage/prune",
    "/api/backup/settings",
    "/api/backup/status",
    "/api/questions",
    "/api/voice",
    "/api/voice/transcribe",
    "/api/voice/speak",
  ]) {
    const request = new Request(`http://localhost:4000${path}`);
    expect(requiresBrowserSession(request, new URL(request.url))).toBe(true);
  }
});
