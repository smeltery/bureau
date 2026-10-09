import { describe, expect, test } from "bun:test";
import { freezeAppHostDomain } from "../../apps/domain.ts";
import { createFetchHandler } from "../router.ts";

const localServer = {
  requestIP: () => ({ address: "127.0.0.1", port: 12345, family: "IPv4" }),
  upgrade: () => false,
} as never;

describe("unknown API routes", () => {
  test("returns a JSON 404 instead of the app shell", async () => {
    freezeAppHostDomain();
    const fetch = createFetchHandler();
    for (const path of ["/api/missing-route", "/api/", "/api%2fmissing-route", "/api%2Fmissing-route"]) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const response = await fetch(new Request(`http://localhost${path}`, { method }), localServer);
        expect(response?.status).toBe(404);
        expect(response?.headers.get("content-type")).toContain("application/json");
        expect(await response?.json()).toEqual({ error: "not_found" });
      }
    }
  });
});
