import { afterEach, describe, expect, test } from "bun:test";
import { buildPublicOrigin, freezeBootState, isOutsideReachabilityBlocked, isProcessBoundLoopback, setHasOwnerProvider, setPublicOriginFallback } from "./http-env.ts";

afterEach(() => {
  delete process.env.BUREAU_PUBLIC_ORIGIN;
  delete process.env.PORT;
  setHasOwnerProvider(() => false);
  setPublicOriginFallback(null);
  freezeBootState({ externalAccess: false, networkBind: "auto" });
});

describe("auth boot network binding", () => {
  test("auto preserves the historical external-access bind rule", () => {
    setHasOwnerProvider(() => true);
    freezeBootState({ externalAccess: true, networkBind: "auto" });

    expect(isOutsideReachabilityBlocked()).toBe(false);
    expect(isProcessBoundLoopback()).toBe(false);
  });

  test("loopback bind can sit behind a public origin", () => {
    process.env.PORT = "4123";
    setPublicOriginFallback("https://office.example");
    setHasOwnerProvider(() => true);
    freezeBootState({ externalAccess: true, networkBind: "loopback" });

    expect(isOutsideReachabilityBlocked()).toBe(false);
    expect(isProcessBoundLoopback()).toBe(true);
    expect(buildPublicOrigin()).toEqual({
      origin: "https://office.example",
      isHttps: true,
      source: "config",
    });
  });

  test("pre-claim remains loopback even when networkBind asks for all", () => {
    setHasOwnerProvider(() => false);
    freezeBootState({ externalAccess: true, networkBind: "all" });

    expect(isOutsideReachabilityBlocked()).toBe(true);
    expect(isProcessBoundLoopback()).toBe(true);
  });
});
