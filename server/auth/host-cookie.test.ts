import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { _testResetBrowserSessionDiagnostics, browserSessionDiagnostic, COOKIE_NAME, emitBrowserSessionDiagnostic, formatBrowserSessionDiagnostic, HOST_COOKIE_NAME } from "./auth.ts";
import { readSessionCookies as parseCookies } from "./http-env.ts";

function reqWithCookies(header: string | null): Request {
  return new Request("https://local.test/", { headers: header === null ? {} : { cookie: header } });
}
const readSessionCookies = (req: Request) => parseCookies(req, true);

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
