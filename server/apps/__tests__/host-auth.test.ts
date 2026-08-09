// The app-host sign-in handshake at the handler seam: the office's mint route,
// the app host's redeem route, and the two gates. The dispatcher that mounts
// them lands separately (server/apps/host/dispatch.ts), so everything here calls
// the handlers directly with an injected registry and an injected office-session
// store — no server, no systemd, no LLM.
//
// What this freezes:
//   - THE ROUND TRIP: bounce -> mint -> redeem -> authenticated, with the exact
//     Location, the exact cookie attributes and the two anti-leak headers.
//   - The callback URL carries the CODE AND NOTHING ELSE. The requested path
//     rides the server-side record, so a second value never reaches a browser's
//     history.
//   - ONLY THE APP'S OWNER AND OFFICE OWNERS GET IN, at mint, at redeem, and on
//     every request through the gate.
//   - NOTHING LEAKS: an app that is not this caller's answers byte-for-byte what
//     a nonexistent one answers, and every way a code can fail answers with one
//     body.
//   - Only a document navigation is bounced. A POST, an XHR and a WebSocket
//     upgrade get a refusal instead of a 302 that would lose the method, fail as
//     an opaque CORS error, or be unfollowable.

import { beforeEach, describe, expect, it } from "bun:test";
import type { AppRecord } from "../../../shared/apps.ts";
import { buildPublicOrigin, type SessionLookup } from "../../auth/auth.ts";
import { APP_AUTH_PATH, APP_COOKIE_NAME, APP_MINT_PATH, appHostAuthGate, appHostWsAuthGate, handleAppAuthRedeem, handleAppMintRequest } from "../host/auth.ts";
import { _testResetAppAuth, _testSetOfficeSessionResolver, type OfficeSessionFacts } from "../host/auth-store.ts";
import { neutralNotFound } from "../host/responses.ts";
import type { AppRegistry } from "../registry.ts";

const DOMAIN = "office.example";
const LABEL = "hello";
const HOST = `${LABEL}.${DOMAIN}`;
const ABSOLUTE = 5_000_000_000_000;

function record(over: Partial<AppRecord> = {}): AppRecord {
  return {
    name: LABEL,
    hostLabel: LABEL,
    hostGen: 1,
    port: 21000,
    command: "bun run serve.ts",
    cwd: "/srv/hello",
    dataDir: "/state/apps/data/hello",
    userId: "u-alice",
    username: "alice",
    createdBy: "AppBot",
    createdAt: 1,
    ...over,
  };
}

// Only `list()` is ever reached from this module; anything else would be a bug
// the cast makes loud rather than silent.
function registryOf(...apps: AppRecord[]): AppRegistry {
  return { list: () => apps } as unknown as AppRegistry;
}

function unreadableRegistry(): AppRegistry {
  return {
    list: () => {
      throw new Error("apps.json is unreadable");
    },
  } as unknown as AppRegistry;
}

function session(over: Partial<SessionLookup> = {}): SessionLookup {
  return { sessionIdHash: "a".repeat(64), sessionPrefix: "abcd1234", userId: "u-alice", username: "alice", role: "member", needsRolling: false, absoluteExpiresAt: ABSOLUTE, ...over };
}

function officeSays(facts: Partial<OfficeSessionFacts> | null): void {
  if (facts === null) {
    _testSetOfficeSessionResolver(() => null);
    return;
  }
  _testSetOfficeSessionResolver(() => ({ userId: "u-alice", role: "member", absoluteExpiresAt: ABSOLUTE, ...facts }));
}

const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

function appReq(path = "/", headers: Record<string, string> = {}, method = "GET"): Request {
  return new Request(`https://${HOST}${path}`, { method, headers });
}

// The office's mint route, as the router will call it: URL parsed, session
// already established by the auth wall.
function mintReq(query: string, opts: { session?: SessionLookup; apps?: AppRecord[]; domain?: string | null } = {}): Response {
  const url = new URL(`https://${DOMAIN}${APP_MINT_PATH}${query}`);
  const req = new Request(url, { method: "GET" });
  return handleAppMintRequest(req, url, opts.session ?? session(), { appHostDomain: opts.domain === undefined ? DOMAIN : opts.domain, registry: registryOf(...(opts.apps ?? [record()])) });
}

// Mint, then hand the code straight to the app host, which is what a browser
// does with the 302.
function codeFrom(res: Response): string {
  return new URL(res.headers.get("location")!).searchParams.get("code")!;
}

async function sameBytes(a: Response, b: Response): Promise<void> {
  expect(a.status).toBe(b.status);
  expect([...a.headers].sort()).toEqual([...b.headers].sort());
  expect(await a.text()).toBe(await b.text());
}

beforeEach(() => {
  _testResetAppAuth();
  officeSays({});
});

describe("the office mint route", () => {
  it("mints a code and redirects to the app host, carrying the code and nothing else", () => {
    const res = mintReq(`?app=${LABEL}&r=%2Fdashboard%3Ftab%3D1`);
    expect(res.status).toBe(302);
    const callback = new URL(res.headers.get("location")!);
    expect(callback.origin).toBe(`https://${HOST}`);
    expect(callback.pathname).toBe(APP_AUTH_PATH);
    expect([...callback.searchParams.keys()]).toEqual(["code"]);
    expect(callback.searchParams.get("code")!.length).toBeGreaterThan(20);
    // The anti-leak pair: this response's own URL is about to carry a credential.
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Nothing to migrate on this request, so no cookie rides along. (The office
    // cookie migration itself is the auth layer's, and tested there.)
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("builds the callback from the registry and the frozen domain, never from the request", () => {
    // The label the caller typed only ever selects a record; the hostname comes
    // from that record plus the office's own domain.
    const res = mintReq(`?app=${LABEL}`, { apps: [record({ hostLabel: LABEL, hostGen: 4 })] });
    expect(new URL(res.headers.get("location")!).host).toBe(HOST);
  });

  it("answers unknown, retired, not-mine and unreadable-registry labels identically", async () => {
    const notFound = neutralNotFound();
    await sameBytes(mintReq("?app=nope"), notFound.clone());
    // Somebody else's app: a member must not be able to learn it exists.
    await sameBytes(mintReq(`?app=${LABEL}`, { session: session({ userId: "u-bob" }) }), notFound.clone());
    // An unowned app (registered from a loopback shell) is not a member's either.
    await sameBytes(mintReq(`?app=${LABEL}`, { apps: [record({ userId: null, username: null })] }), notFound.clone());
    // A registry that cannot be read cannot vouch for a label.
    const url = new URL(`https://${DOMAIN}${APP_MINT_PATH}?app=${LABEL}`);
    await sameBytes(handleAppMintRequest(new Request(url), url, session(), { appHostDomain: DOMAIN, registry: unreadableRegistry() }), notFound.clone());
    // No app hostnames on this office at all: its deployment shape is not
    // something to report either.
    await sameBytes(mintReq(`?app=${LABEL}`, { domain: null }), notFound.clone());
    // No label at all is the same answer, and so is any method but GET.
    await sameBytes(mintReq(""), notFound.clone());
    const postUrl = new URL(`https://${DOMAIN}${APP_MINT_PATH}?app=${LABEL}`);
    await sameBytes(handleAppMintRequest(new Request(postUrl, { method: "POST" }), postUrl, session(), { appHostDomain: DOMAIN, registry: registryOf(record()) }), notFound.clone());
  });

  it("lets an office owner reach an app that is not theirs", () => {
    expect(mintReq(`?app=${LABEL}`, { session: session({ userId: "u-boss", role: "owner" }) }).status).toBe(302);
    expect(mintReq(`?app=${LABEL}`, { apps: [record({ userId: null, username: null })], session: session({ userId: "u-boss", role: "owner" }) }).status).toBe(302);
  });

  it("refuses a return path that is not a path, and a repeated parameter", async () => {
    for (const query of [`?app=${LABEL}&r=%2F%2Fevil.example`, `?app=${LABEL}&r=https%3A%2F%2Fevil.example`, `?app=${LABEL}&r=${LABEL}`, `?app=${LABEL}&app=other`, `?app=${LABEL}&r=%2Fa&r=%2Fb`]) {
      const res = mintReq(query);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("bad request\n");
    }
  });

  it("defaults a missing return path to the app's root", () => {
    const res = mintReq(`?app=${LABEL}`);
    const redeemed = handleAppAuthRedeem(appReq(`${APP_AUTH_PATH}?code=${codeFrom(res)}`), { host: HOST, app: record() });
    expect(redeemed.headers.get("location")).toBe("/");
  });

  it("rate-limits minting per office session", async () => {
    let last = mintReq(`?app=${LABEL}`);
    for (let i = 0; i < 30 && last.status === 302; i++) last = mintReq(`?app=${LABEL}`);
    expect(last.status).toBe(429);
    expect(await last.text()).toBe("too many app sign-in attempts; wait a minute and try again\n");
    // Another session is unaffected: the budget is per office session.
    expect(mintReq(`?app=${LABEL}`, { session: session({ sessionIdHash: "b".repeat(64) }) }).status).toBe(302);
  });
});

describe("the app host's redeem route", () => {
  function redeem(code: string, app = record()): Response {
    return handleAppAuthRedeem(appReq(`${APP_AUTH_PATH}?code=${encodeURIComponent(code)}`), { host: HOST, app });
  }

  it("sets the app cookie for this hostname and returns to the remembered path", () => {
    const code = codeFrom(mintReq(`?app=${LABEL}&r=%2Fdashboard%3Ftab%3D1`));
    const res = redeem(code);
    expect(res.status).toBe(302);
    // The path came off the server-side record, not out of the callback URL.
    expect(res.headers.get("location")).toBe("/dashboard?tab=1");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const cookies = res.headers.getSetCookie();
    expect(cookies.length).toBe(1);
    const [line] = cookies;
    expect(line.startsWith(`${APP_COOKIE_NAME}=`)).toBe(true);
    // `__Host-` demands exactly these; without them a browser drops the cookie.
    expect(line).toContain("; Path=/");
    expect(line).toContain("; HttpOnly");
    expect(line).toContain("; SameSite=Lax");
    expect(line).toContain("; Secure");
    expect(line).not.toContain("Domain=");
    // The value is a fresh random token, never the office session's id or hash.
    const value = line.slice(APP_COOKIE_NAME.length + 1, line.indexOf(";"));
    expect(value.length).toBeGreaterThan(20);
    expect(value).not.toBe(session().sessionIdHash);
    // 12h app session, capped by the office session's absolute expiry.
    expect(line).toContain("; Max-Age=43200");
  });

  it("answers every way a code can fail with one body", async () => {
    const spent = codeFrom(mintReq(`?app=${LABEL}`));
    redeem(spent);
    const cases: Response[] = [
      redeem(spent), // replayed
      redeem("Zm9vYmFy"), // never minted
      redeem("not base64url!"), // malformed
      handleAppAuthRedeem(appReq(APP_AUTH_PATH), { host: HOST, app: record() }), // no code
      handleAppAuthRedeem(appReq(`${APP_AUTH_PATH}?code=a&code=b`), { host: HOST, app: record() }), // repeated
      redeem(codeFrom(mintReq(`?app=${LABEL}`)), record({ hostGen: 2 })), // a later generation of the name
    ];
    // A code minted against an office session that has since gone, and one whose
    // user may no longer reach the app: both are refused at redeem time, because
    // the session is revalidated there rather than trusted from the code.
    const orphan = codeFrom(mintReq(`?app=${LABEL}`));
    officeSays(null);
    cases.push(redeem(orphan));
    officeSays({ userId: "u-bob" });
    const demoted = codeFrom(mintReq(`?app=${LABEL}`, { session: session({ userId: "u-bob", role: "owner" }) }));
    cases.push(redeem(demoted));
    for (const res of cases) {
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("sign-in link expired; open the app again from the office\n");
    }
  });

  it("refuses a code presented at a different app's hostname", async () => {
    const code = codeFrom(mintReq(`?app=${LABEL}`));
    const res = handleAppAuthRedeem(new Request(`https://other.${DOMAIN}${APP_AUTH_PATH}?code=${code}`), { host: `other.${DOMAIN}`, app: record({ hostLabel: "other", name: "other" }) });
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe("the gates", () => {
  function signedIn(): string {
    const res = handleAppAuthRedeem(appReq(`${APP_AUTH_PATH}?code=${codeFrom(mintReq(`?app=${LABEL}`))}`), { host: HOST, app: record() });
    const line = res.headers.getSetCookie()[0];
    return line.slice(APP_COOKIE_NAME.length + 1, line.indexOf(";"));
  }
  const withCookie = (token: string, extra: Record<string, string> = {}) => ({ cookie: `${APP_COOKIE_NAME}=${token}`, ...extra });

  it("lets a live app session through, on both arms", () => {
    const token = signedIn();
    expect(appHostAuthGate(appReq("/", withCookie(token, NAV)), { host: HOST, app: record() })).toBeNull();
    expect(appHostWsAuthGate(appReq("/ws", withCookie(token, { upgrade: "websocket" })), { host: HOST, app: record() })).toBeNull();
  });

  it("stops letting it through the moment the office session stops permitting the app", () => {
    const token = signedIn();
    officeSays({ userId: "u-bob" });
    expect(appHostAuthGate(appReq("/", withCookie(token, NAV)), { host: HOST, app: record() })?.status).toBe(302);
    officeSays(null);
    expect(appHostWsAuthGate(appReq("/ws", withCookie(token, { upgrade: "websocket" })), { host: HOST, app: record() })?.status).toBe(401);
  });

  it("bounces a navigation with no cookie to the office, naming the app and the path", () => {
    const res = appHostAuthGate(appReq("/dashboard?tab=1", NAV), { host: HOST, app: record() })!;
    expect(res.status).toBe(302);
    const target = new URL(res.headers.get("location")!);
    expect(target.origin).toBe(buildPublicOrigin().origin);
    expect(target.pathname).toBe(APP_MINT_PATH);
    expect(target.searchParams.get("app")).toBe(LABEL);
    expect(target.searchParams.get("r")).toBe("/dashboard?tab=1");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    // Nothing was presented, so there is nothing to clear.
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("clears a cookie it rejected, including one that is present but empty", () => {
    const clear = `${APP_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
    const bounced = appHostAuthGate(appReq("/", { cookie: `${APP_COOKIE_NAME}=`, ...NAV }), { host: HOST, app: record() })!;
    expect(bounced.status).toBe(302);
    expect(bounced.headers.getSetCookie()).toEqual([clear]);
    const refused = appHostAuthGate(appReq("/", withCookie("Zm9vYmFy"), "POST"), { host: HOST, app: record() })!;
    expect(refused.status).toBe(401);
    expect(refused.headers.getSetCookie()).toEqual([clear]);
    const ws = appHostWsAuthGate(appReq("/ws", withCookie("Zm9vYmFy", { upgrade: "websocket" })), { host: HOST, app: record() })!;
    expect(ws.headers.getSetCookie()).toEqual([clear]);
  });

  it("refuses everything that could not complete a handshake anyway", async () => {
    const cases = [
      appHostAuthGate(appReq("/", NAV, "POST"), { host: HOST, app: record() })!,
      appHostAuthGate(appReq("/", { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }), { host: HOST, app: record() })!,
      appHostAuthGate(appReq("/x.js", { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" }), { host: HOST, app: record() })!,
      appHostAuthGate(appReq("/", NAV, "HEAD"), { host: HOST, app: record() })!,
      // An upgrade gets the honest answer rather than a 302 it could not follow -
      // including one from a client that sends no Fetch Metadata at all.
      appHostWsAuthGate(appReq("/ws", { upgrade: "websocket", ...NAV }), { host: HOST, app: record() })!,
      appHostWsAuthGate(appReq("/ws", { upgrade: "websocket" }), { host: HOST, app: record() })!,
    ];
    for (const res of cases) {
      expect(res.status).toBe(401);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.text()).toBe("authentication required\n");
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it("does not decide the permit question on the app host, where there is no identity yet", () => {
    // A caller who may not reach this app is bounced like anyone else; the office
    // answers the neutral 404 there, once it knows who is asking. The app host
    // must not say "no such app" and must not say "forbidden" - it knows neither.
    const res = appHostAuthGate(appReq("/", NAV), { host: HOST, app: record({ userId: "u-bob" }) })!;
    expect(res.status).toBe(302);
  });
});
