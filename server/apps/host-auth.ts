// The sign-in handshake for registered-app hostnames.
//
// Consumed by server/apps/host-dispatch.ts (landing next) for the app-host side
// — the redeem route and the two gates — and by the office's router for the mint
// route (APP_MINT_PATH), which must sit BEHIND the office's ordinary auth wall.
// Nothing here relays app bytes.
//
// An app lives at `hello.office.example` and the office at `office.example`. The
// office session cookie is host-only, deliberately — that is what keeps a scratch
// app built by an agent from being able to act as the boss — so it never reaches
// the app host, and the app host therefore has no way to know who is knocking.
// This module is how it finds out, in three hops, none of which lets the office
// cookie leave the office origin:
//
//   1. the app host bounces the request to the office — only a GET that could
//      complete the round trip — naming the app and the path asked for;
//   2. the office, where the session cookie IS readable, mints a single-use code
//      and redirects back to the app host carrying only that code;
//   3. the app host redeems the code, sets its OWN cookie for that one hostname,
//      and sends the browser to the path from step 1.
//
// Afterwards the app host has a cookie of its own, bound to the app and to the
// office session that vouched for it, and revalidated against that session on
// every request — so signing out of the office closes every app with it, and a
// user who loses access to an app loses it mid-session.
//
// WHAT IS IN A URL, AND WHY THAT IS THE WHOLE THREAT MODEL. A code has to cross
// an origin boundary, and the only way across is a URL — so for one round trip a
// credential lives somewhere a browser writes down. Every rule here follows from
// that: 45-second lifetime, one redemption ever, bound to the exact app host and
// to the minting session, `Referrer-Policy: no-referrer` on every response whose
// own URL holds it, `Cache-Control: no-store` everywhere, the path kept
// server-side so it is not a second thing to leak, and not one line of logging
// that touches a URL.

import type { AppRecord } from "../../shared/apps.ts";
import { buildPublicOrigin, readSessionCookies, sessionCookieMigrationHeaders, type SessionLookup } from "../auth/auth.ts";
import { appRegistry as productionRegistry, type AppRegistry } from "./registry.ts";
import { APP_AUTH_PATH, APP_MINT_PATH, appCookieClearLine, appCookieLine, readAppCookie } from "./host-auth-cookie.ts";
import { mayInitiateHandshake, mayReachApp, validateReturnPath } from "./host-auth-permit.ts";
import { mintAppCode, officeSessionByHash, redeemAppCode, startAppSession, validateAppSession } from "./host-auth-store.ts";
import { AUTH_REQUIRED_BODY, BAD_REQUEST_BODY, MINT_LIMITED_BODY, SIGN_IN_FAILED_BODY, handshake, handshakeRedirect, neutralNotFound } from "./host-responses.ts";

// The surface a consumer needs, re-exported so the dispatcher and the office
// router each have ONE import site and cannot pick up a second definition of a
// path or a cookie name.
export { APP_AUTH_PATH, APP_COOKIE_NAME, APP_MINT_PATH, APP_RESERVED_PATH, appCookieClearLine, readAppCookie } from "./host-auth-cookie.ts";
export { mayInitiateHandshake, mayReachApp, validateReturnPath, type AppViewer } from "./host-auth-permit.ts";
export { validateAppSession } from "./host-auth-store.ts";

// --- office side: GET /auth/app?app=<label>&r=<path> -------------------------

// Exactly one value per parameter. A repeated parameter is a request somebody
// built by hand, and "first one wins" is the kind of ambiguity that turns into a
// bypass when two layers disagree about which one won.
function singleParam(url: URL, name: string): string | null | undefined {
  const all = url.searchParams.getAll(name);
  if (all.length === 0) return null;
  if (all.length > 1) return undefined; // malformed
  return all[0];
}

function liveAppByLabel(registry: AppRegistry, label: string): AppRecord | null {
  try {
    return registry.list().find((app) => app.hostLabel === label) ?? null;
  } catch (err) {
    // A registry that cannot be read cannot vouch for a label. Fail closed, and
    // indistinguishably from a label that does not exist.
    console.error("[app-auth] app registry unreadable; refusing label:", err);
    return null;
  }
}

// Mints a code for a signed-in office user and redirects to the app host.
//
// The CALLER has already established the identity: this runs behind the office's
// auth wall, so an unauthenticated visitor met the login page before reaching
// here, and `session` is the caller's own cookie session.
//
// The wall does NOT bring a CSRF check with it — authenticate() checks Origin only
// on unsafe methods — so this GET can be triggered cross-site by any page a
// signed-in user visits. Accepted deliberately: the attacker cannot read the
// code, the cookie it produces is bound to the victim's own session and to an app
// that user may already open, and the cost is a slice of that session's mint
// budget. It is the shape every SSO authorize endpoint has.
export function handleAppMintRequest(req: Request, url: URL, session: SessionLookup, opts: { appHostDomain: string | null; registry?: AppRegistry; now?: number }): Response {
  // Defined as a GET. Any other method is not this route at all.
  if (req.method !== "GET") return neutralNotFound();
  // No app-host domain means this office has no app hostnames, so there is no
  // origin to send anybody to. Same refusal as an unknown label: the office's
  // deployment shape is not something to report.
  if (opts.appHostDomain === null) return neutralNotFound();

  const labelParam = singleParam(url, "app");
  const rParam = singleParam(url, "r");
  if (labelParam === undefined || rParam === undefined) {
    return handshake(400, BAD_REQUEST_BODY);
  }
  if (labelParam === null) return neutralNotFound();

  const registry = opts.registry ?? productionRegistry;
  const app = liveAppByLabel(registry, labelParam);
  if (app === null) return neutralNotFound();
  // Only the app's owner and office owners may open an app. A refusal is the
  // SAME 404 an unknown label gets: that another user has an app called `hello`
  // is not this caller's business, and a distinct 403 would turn the mint
  // endpoint into a label oracle for every signed-in member.
  if (!mayReachApp(app, { userId: session.userId, role: session.role })) return neutralNotFound();

  const returnPath = validateReturnPath(rParam);
  if (returnPath === null) return handshake(400, BAD_REQUEST_BODY);

  // Built from the registry's own label and the boot-frozen domain — never from a
  // request value — so there is nothing here to point elsewhere.
  const appHost = `${app.hostLabel}.${opts.appHostDomain}`;
  const minted = mintAppCode({ label: app.hostLabel, hostGen: app.hostGen, appHost, officeSessionHash: session.sessionIdHash, returnPath }, opts.now);
  if ("error" in minted) return handshake(429, MINT_LIMITED_BODY);

  // The `__Host-` office-cookie migration rides this response like it rides a
  // page load or a safe /api GET, and it matters MORE here than on those: this is
  // the door into the app origins, and the point of that migration is to close
  // cookie shadowing from a sibling subdomain BEFORE one exists. A user who
  // reached an app while still holding only the legacy, shadowable office cookie
  // would be exactly the case it was for. Both cookies are read through the
  // office's own helper, so this cannot select an identity the caller's session
  // did not already establish.
  const migration = sessionCookieMigrationHeaders(readSessionCookies(req), session);
  return handshakeRedirect(`https://${appHost}${APP_AUTH_PATH}?code=${encodeURIComponent(minted.code)}`, migration);
}

// --- app-host side ----------------------------------------------------------

export interface AppHostContext {
  // The request's normalized Host, and the live app it resolved to. Both come
  // from the dispatcher, which has already classified the host and confirmed the
  // app is live — this module never re-derives either.
  host: string;
  app: AppRecord;
  now?: number;
}

// GET /__bureau/auth?code=... on an app host: redeem, set the cookie, go to the
// path the code remembers.
export function handleAppAuthRedeem(req: Request, ctx: AppHostContext): Response {
  const now = ctx.now ?? Date.now();
  const url = new URL(req.url);
  const codeParam = singleParam(url, "code");
  if (codeParam === undefined || codeParam === null) {
    return handshake(400, SIGN_IN_FAILED_BODY);
  }
  const record = redeemAppCode(codeParam, { host: ctx.host, label: ctx.app.hostLabel, now });
  if (record === null) return handshake(400, SIGN_IN_FAILED_BODY);
  // The generation is checked against the app that is live NOW, not the one that
  // was live at mint time: a code minted seconds before a delete and a
  // re-registration must not open the successor.
  if (record.hostGen !== ctx.app.hostGen) {
    return handshake(400, SIGN_IN_FAILED_BODY);
  }
  // The office session has to still be alive, and its absolute cap is what bounds
  // the app session. Revalidating here rather than trusting the code closes the
  // window between mint and redeem — and the permit decision is re-asked with it,
  // so a user demoted or an app re-owned in that window redeems nothing.
  const office = officeSessionByHash(record.officeSessionHash);
  if (office === null) return handshake(400, SIGN_IN_FAILED_BODY);
  if (!mayReachApp(ctx.app, { userId: office.userId, role: office.role })) {
    return handshake(400, SIGN_IN_FAILED_BODY);
  }

  const started = startAppSession({ label: ctx.app.hostLabel, hostGen: ctx.app.hostGen, officeSessionHash: record.officeSessionHash, absoluteExpiresAt: office.absoluteExpiresAt }, now);
  if (started === null) return handshake(400, SIGN_IN_FAILED_BODY);

  return handshakeRedirect(record.returnPath, [appCookieLine(started.token, started.maxAgeSec)]);
}

function holdsLiveAppSession(req: Request, ctx: AppHostContext): boolean {
  return validateAppSession(readAppCookie(req), { app: ctx.app, now: ctx.now });
}

// The same question for a WebSocket upgrade, which needs its own answer rather
// than the gate below.
//
// The difference is not stylistic: the gate's non-session path either BOUNCES a
// request into the handshake or refuses it, and an upgrade can do neither
// usefully. A browser's upgrade carries `Sec-Fetch-Dest: websocket`, so it would
// take the refusal branch; a hand-built client with no Fetch Metadata would take
// the REDIRECT branch and be handed a 302 no WebSocket client can follow. Both
// end in failure, one of them confusingly. So an upgrade gets one answer, the
// honest one: hold a live app session or be refused.
//
// In practice a browser reaches an app's page over HTTP first, which is where the
// session is established, so a real app's socket opens with the cookie already in
// hand.
export function appHostWsAuthGate(req: Request, ctx: AppHostContext): Response | null {
  const rawCookie = readAppCookie(req);
  if (holdsLiveAppSession(req, ctx)) return null;
  // Presented and rejected -> clear it, exactly as the gate does; absent ->
  // nothing to clear. Same helper, so the two cannot emit different bytes.
  return handshake(401, AUTH_REQUIRED_BODY, rawCookie === null ? undefined : { "Set-Cookie": appCookieClearLine() });
}

// The gate in front of everything an app host serves. Returns null when the
// caller holds a live app session and the request may proceed to the relay.
//
// Otherwise: a request that may start the handshake is bounced into it, and
// anything else is refused. When a cookie was presented and rejected, the refusal
// clears it — a dead credential must not sit in a browser waiting to confuse its
// owner.
export function appHostAuthGate(req: Request, ctx: AppHostContext): Response | null {
  const rawCookie = readAppCookie(req);
  if (holdsLiveAppSession(req, ctx)) return null;
  // PRESENT and rejected -> clear it, whatever the reason it failed (expired,
  // revoked, no longer permitted, another app's, or empty). Absent -> nothing to
  // clear.
  const clear = rawCookie === null ? [] : [appCookieClearLine()];
  if (!mayInitiateHandshake(req)) {
    return handshake(401, AUTH_REQUIRED_BODY, clear.length > 0 ? { "Set-Cookie": clear[0] } : undefined);
  }
  const url = new URL(req.url);
  // A caller who may not reach this app is bounced all the same, and the office
  // answers the neutral 404 there. The app host deliberately does not decide it:
  // deciding needs an identity, and this request has none yet.
  const target = `${buildPublicOrigin().origin}${APP_MINT_PATH}?app=${encodeURIComponent(ctx.app.hostLabel)}&r=${encodeURIComponent(`${url.pathname}${url.search}`)}`;
  return handshakeRedirect(target, clear);
}
