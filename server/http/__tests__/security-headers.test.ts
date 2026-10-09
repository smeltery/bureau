import { describe, expect, test } from "bun:test";
import { freezeAppHostDomain } from "../../apps/domain.ts";
import { createFetchHandler } from "../router.ts";

function server(address: string | null = "127.0.0.1") {
  return {
    requestIP: () => (address ? { address, port: 12345, family: "IPv4" } : null),
    upgrade: () => false,
  } as never;
}

// Freeze before each call into the production fetch handler, and leave the
// module frozen afterwards. Resetting here used to clear the boot freeze for
// the rest of the suite; with any leftover Bun.serve still answering (or a
// browser probing localhost), a late GET /ws then threw
// "appHostDomain() called before freezeAppHostDomain" between tests.
describe("office security headers", () => {
  test("adds baseline hardening headers to public office responses", async () => {
    freezeAppHostDomain();
    const fetch = createFetchHandler();

    const res = await fetch(new Request("http://local.test/readyz"), server());

    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-security-policy")).toContain("base-uri 'self'");
    expect(res?.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res?.headers.get("permissions-policy")).toContain("camera=()");
    expect(res?.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res?.headers.get("x-frame-options")).toBe("DENY");
  });

  test("serves security.txt without authentication", async () => {
    freezeAppHostDomain();
    const fetch = createFetchHandler();

    const res = await fetch(new Request("http://local.test/.well-known/security.txt"), server());

    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toContain("text/plain");
    expect(await res?.text()).toContain("Contact: https://github.com/dotbrains/bureau/security/advisories/new");
    expect(res?.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("unknown API routes", () => {
  test("returns a JSON 404 instead of the app shell", async () => {
    freezeAppHostDomain();
    const fetch = createFetchHandler();
    for (const path of ["/api/missing-route", "/api/", "/api%2fmissing-route", "/api%2Fmissing-route"]) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const response = await fetch(new Request(`http://localhost${path}`, { method }), server());
        expect(response?.status).toBe(404);
        expect(response?.headers.get("content-type")).toContain("application/json");
        expect(await response?.json()).toEqual({ error: "not_found" });
      }
    }
  });
});
