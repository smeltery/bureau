import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { _testResetBrowserSessionDiagnostics, browserSessionDiagnostic, COOKIE_NAME, emitBrowserSessionDiagnostic, formatBrowserSessionDiagnostic, HOST_COOKIE_NAME } from "./auth.ts";
import { clearCookieLines, cookieWriteName, readSessionCookie, readSessionCookies, sessionCookieMigrationLines } from "./http-env.ts";

function reqWithCookies(header: string | null): Request {
  return new Request("http://local.test/", { headers: header === null ? {} : { cookie: header } });
}

describe("readSessionCookies", () => {
  test("the __Host- name wins over the legacy one, in either header order", () => {
    expect(readSessionCookies(reqWithCookies(`${HOST_COOKIE_NAME}=hostval; ${COOKIE_NAME}=oldval`)).selected).toBe("hostval");
    expect(readSessionCookies(reqWithCookies(`${COOKIE_NAME}=oldval; ${HOST_COOKIE_NAME}=hostval`)).selected).toBe("hostval");
  });

  test("a legacy-only jar still reads — every pre-HTTPS install has one", () => {
    const cookies = readSessionCookies(reqWithCookies(`${COOKIE_NAME}=oldval`));
    expect(cookies).toEqual({ hostRaw: null, legacyRaw: "oldval", selected: "oldval" });
  });

  test("first occurrence wins per name; a later duplicate never overwrites", () => {
    expect(readSessionCookies(reqWithCookies(`${COOKIE_NAME}=first; ${COOKIE_NAME}=second`)).selected).toBe("first");
  });

  test("an empty __Host- cookie is present: it blocks the legacy fallback", () => {
    const req = reqWithCookies(`${HOST_COOKIE_NAME}=; ${COOKIE_NAME}=oldval`);
    expect(readSessionCookies(req).selected).toBe("");
    expect(readSessionCookie(req)).toBeNull();
  });

  test("no session cookie at all selects nothing", () => {
    expect(readSessionCookies(reqWithCookies("other=x")).selected).toBeNull();
    expect(readSessionCookies(reqWithCookies(null)).selected).toBeNull();
  });
});

describe("sessionCookieMigrationLines", () => {
  const soon = Date.now() + 60_000;

  test("plain HTTP never migrates — the prefix requires Secure", () => {
    expect(sessionCookieMigrationLines({ hostRaw: null, legacyRaw: "raw" }, soon, false)).toEqual([]);
  });

  test("UPGRADE: legacy-only re-issues the same raw id under the __Host- name", () => {
    const lines = sessionCookieMigrationLines({ hostRaw: null, legacyRaw: "raw" }, soon, true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`${HOST_COOKIE_NAME}=raw; `);
    expect(lines[0]).toContain("Secure");
    // Anchored to the absolute cap — a migration must never extend a session.
    expect(lines[0]).toMatch(/Max-Age=(59|60)/);
  });

  test("RETIRE: once the __Host- cookie is observed, the legacy name is cleared", () => {
    const lines = sessionCookieMigrationLines({ hostRaw: "raw", legacyRaw: "raw" }, soon, true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`${COOKIE_NAME}=; `);
    expect(lines[0]).toContain("Max-Age=0");
  });

  test("steady state (host-only) and cookieless requests emit nothing", () => {
    expect(sessionCookieMigrationLines({ hostRaw: "raw", legacyRaw: null }, soon, true)).toEqual([]);
    expect(sessionCookieMigrationLines({ hostRaw: null, legacyRaw: null }, soon, true)).toEqual([]);
  });
});

describe("cookie write and clear names", () => {
  test("the write name follows the deployment: __Host- only on HTTPS", () => {
    expect(cookieWriteName(true)).toBe(HOST_COOKIE_NAME);
    expect(cookieWriteName(false)).toBe(COOKIE_NAME);
  });

  test("sign-out clears both names on every deployment, __Host- always Secure", () => {
    const onHttp = clearCookieLines(false);
    expect(onHttp).toHaveLength(2);
    expect(onHttp[0]).toStartWith(`${COOKIE_NAME}=; `);
    expect(onHttp[0]).not.toContain("Secure");
    expect(onHttp[1]).toStartWith(`${HOST_COOKIE_NAME}=; `);
    expect(onHttp[1]).toContain("Secure");
    const onHttps = clearCookieLines(true);
    expect(onHttps[0]).toContain("Secure");
    expect(onHttps[1]).toContain("Secure");
  });
});

describe("browser session diagnostics", () => {
  test("reports a request with no session cookie", () => {
    expect(browserSessionDiagnostic(readSessionCookies(reqWithCookies(null)), null, "http")).toEqual({
      outcome: "cookie_absent",
      gate: "http",
    });
  });

  test("reports legacy selection when the prefixed cookie is missing", () => {
    expect(
      browserSessionDiagnostic(
        readSessionCookies(reqWithCookies(`${COOKIE_NAME}=oldval`)),
        { sessionPrefix: "sess", sessionIdHash: "hash", userId: "u", username: "Ada", role: "owner", needsRolling: false, absoluteExpiresAt: 1 },
        "http",
      ),
    ).toEqual({
      outcome: "legacy_selected",
      gate: "http",
    });
  });

  test("reports rejected selected cookies without logging raw values", () => {
    const parsed = readSessionCookies(reqWithCookies(`${HOST_COOKIE_NAME}=not-a-session; ${COOKIE_NAME}=oldval`));
    const expectedMarker = createHash("sha256").update("not-a-session").digest("hex").slice(0, 6);
    const diagnostic = browserSessionDiagnostic(parsed, null, "http");
    expect(diagnostic).toEqual({
      outcome: "cookie_rejected",
      gate: "http",
      selected: "host",
      legacyAlsoPresent: true,
      marker: expectedMarker,
    });
    const line = formatBrowserSessionDiagnostic(
      diagnostic!,
      new Request("https://office.example/api/sessions", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
        },
      }),
    );
    expect(line).toContain(`cookie rejected as invalid or stale selected=__Host legacy_overridden=yes marker=${expectedMarker} gate=http path=/api/sessions client=Chrome/Windows`);
    expect(line).not.toContain("not-a-session");
    expect(line).not.toContain("oldval");
  });

  test("redacts invite tokens and dedupes repeated diagnostics", () => {
    _testResetBrowserSessionDiagnostics();
    const originalLog = console.log;
    const lines: string[] = [];
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      const diagnostic = { outcome: "cookie_absent", gate: "http" } as const;
      const req = new Request("https://office.example/i/live-invite-token");
      emitBrowserSessionDiagnostic(diagnostic, req, 1_000);
      emitBrowserSessionDiagnostic(diagnostic, req, 1_001);
    } finally {
      console.log = originalLog;
      _testResetBrowserSessionDiagnostics();
    }
    expect(lines).toEqual(["[auth] browser session cookie absent gate=http path=/i/<redacted> client=Unknown/Unknown"]);
  });
});
