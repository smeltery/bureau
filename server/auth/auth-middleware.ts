// HTTP middleware + WS upgrade auth + /auth/* routes.
//
// The whole gating layer lives in this file so a future audit can read one
// file end-to-end and trace every request shape.

import type { Server } from "bun";
import {
  acceptInvite,
  buildPublicOrigin,
  claimOwnership,
  clearCookieHeader,
  logoutBySessionHash,
  peekInvite,
  readSessionCookie,
  setCookieHeader,
  validateSession,
  wouldRevokeLeaveOfficeUnreachable,
  type SessionLookup,
} from "./auth.ts";
import { hasOwner } from "../users.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Fires after the office gets its first owner — either through the tokenless
// claim form (handleClaim → claimOwnership) or the legacy bootstrap-invite
// accept path (handleAccept where isBootstrap is true). Awaited best-effort
// after the session has persisted but before the redirect response is
// returned; the hook MUST NOT roll auth state back on its own failure, and
// the caller must log + swallow any throw.
type OwnerCreatedCb = (opts: { username: string }) => Promise<void> | void;
let onOwnerCreated: OwnerCreatedCb | null = null;
export function setOnOwnerCreated(cb: OwnerCreatedCb | null): void {
  onOwnerCreated = cb;
}

// ---------------------------------------------------------------------------
// Loopback detection. Localhost calls (agent-to-server curl, in-process tests)
// bypass cookie auth — the host already trusts its own processes. The cookie
// path exists to gate browser/remote access, not local IPC.

function isLoopback(addr: string | null): boolean {
  if (!addr) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1" || addr.startsWith("127.");
}

export function requestIsLoopback<T>(req: Request, server: Server<T>): boolean {
  try {
    const info = server.requestIP(req);
    return isLoopback(info?.address ?? null);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Origin check. Reverse proxies are configured by the operator setting
// BUREAU_PUBLIC_ORIGIN or office-config.json#publicOrigin; we do not infer
// the origin from Host/X-Forwarded-Host because that's how
// WebSocket-hijacking bugs happen.

export function checkOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const { origin: expected } = buildPublicOrigin();
  return origin === expected;
}

// ---------------------------------------------------------------------------
// Standard response headers for every HTML surface (SPA shell, login,
// invite-accept, error pages).
//
//   Referrer-Policy: no-referrer
//     The invite URL contains a bearer token. Without this header, a
//     future outbound link or subresource on the invite-accept page could
//     leak the token via the Referer header. Suppressed for tokenless
//     pages (claim form, etc) via the `tokenInUrl: false` option —
//     Chrome couples `Referrer-Policy: no-referrer` to a privacy mode
//     where top-level form POSTs send `Origin: null` instead of the
//     page origin, which breaks strict same-origin checks on the form's
//     POST handler.
//
//   Strict-Transport-Security (HTTPS only)
//     HSTS protects later requests that start over HTTP. `includeSubDomains`
//     is NOT set to avoid pinning sibling subdomains on shared parent
//     domains.
export function securityHeaders(opts?: { tokenInUrl?: boolean }): Record<string, string> {
  const tokenInUrl = opts?.tokenInUrl ?? true;
  const { isHttps } = buildPublicOrigin();
  const h: Record<string, string> = {};
  if (tokenInUrl) {
    h["Referrer-Policy"] = "no-referrer";
  }
  if (isHttps) {
    h["Strict-Transport-Security"] = "max-age=31536000";
  }
  return h;
}

// ---------------------------------------------------------------------------
// Auth-result type that the index.ts dispatcher consumes.

export interface AuthOk {
  kind: "ok";
  session: SessionLookup;
}
export interface AuthLoopback {
  kind: "loopback";
}
export interface AuthRejected {
  kind: "rejected";
  response: Response;
}

export type AuthResult = AuthOk | AuthLoopback | AuthRejected;

function wantsJson(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("application/json") || !accept.includes("text/html");
}

function unauthorized(req: Request, officeName: string | null): Response {
  if (wantsJson(req)) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(renderLoginPage(officeName), {
    status: 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Login page has no bearer token in its URL; skip Referrer-Policy:
      // no-referrer so any future form on this page wouldn't trip Chrome's
      // Origin: null behavior.
      ...securityHeaders({ tokenInUrl: false }),
    },
  });
}

// Browser-tab title for /auth/* and /i/<token> pages.
function authPageTitle(officeName: string | null, suffix: string): string {
  return officeName ? `${officeName} | Bureau — ${suffix}` : `Bureau — ${suffix}`;
}

// ---------------------------------------------------------------------------
// Gating function. Called at the top of every fetch handler.

export function authenticate<T>(req: Request, server: Server<T>, opts?: { allowLoopback?: boolean; officeName?: string | null }): AuthResult {
  const looped = !!opts?.allowLoopback && requestIsLoopback(req, server);
  // Origin check runs regardless of the cookie path. A user's browser
  // running on the same machine as the server can otherwise be tricked by
  // a malicious origin into mutating state via the agent-API endpoints
  // (CSRF). We allow missing-Origin (typical for agent curl, which never
  // sends one) but reject mismatched-Origin always.
  if (!SAFE_METHODS.has(req.method)) {
    const originHeader = req.headers.get("origin");
    if (originHeader && !checkOrigin(req)) {
      return {
        kind: "rejected",
        response: new Response(JSON.stringify({ error: "bad origin" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      };
    }
  }
  if (looped) {
    return { kind: "loopback" };
  }
  const cookie = readSessionCookie(req);
  const session = validateSession(cookie);
  if (!session) {
    return { kind: "rejected", response: unauthorized(req, opts?.officeName ?? null) };
  }
  return { kind: "ok", session };
}

// ---------------------------------------------------------------------------
// /auth/* route handlers.

export function handleInvitePeek(_req: Request, token: string, officeName: string | null): Response {
  const peek = peekInvite(token);
  if ("error" in peek) return renderInviteError(peek.error, officeName);
  return new Response(renderAcceptPage(token, peek.needsName, null, officeName), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...securityHeaders(),
    },
  });
}

export async function handleAccept(req: Request, officeName: string | null): Promise<Response> {
  if (!originValidForAuthPost(req)) {
    return new Response("bad origin", { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const tokenField = form?.get("token");
  const nameField = form?.get("name");
  const token = typeof tokenField === "string" ? tokenField : "";
  const name = typeof nameField === "string" ? nameField : "";
  if (!token) return renderInviteError("not_found", officeName);
  const ua = req.headers.get("user-agent");
  const result = await acceptInvite(token, { userAgent: ua, chosenName: name });
  if (!result.ok) {
    if (result.error === "needs_name" || result.error === "invalid_name") {
      return new Response(renderAcceptPage(token, true, "Please pick a display name.", officeName), {
        status: 400,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...securityHeaders(),
        },
      });
    }
    return renderInviteError(result.error, officeName);
  }
  if (result.isBootstrap && onOwnerCreated) {
    try {
      await onOwnerCreated({ username: result.username });
    } catch (err) {
      console.error("[auth] onOwnerCreated threw:", err);
    }
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": setCookieHeader(result.rawSessionId, result.absoluteExpiresAt),
      ...securityHeaders(),
    },
  });
}

export async function handleLogout(req: Request, officeName: string | null): Promise<Response> {
  if (!originValidForAuthPost(req)) {
    return new Response("bad origin", { status: 403 });
  }
  const cookie = readSessionCookie(req);
  const lookup = validateSession(cookie);
  if (lookup && wouldRevokeLeaveOfficeUnreachable(lookup.sessionIdHash)) {
    return new Response(
      renderLockoutBlocked(
        "Sign out refused: this is the last active owner session in the " + "office. Mint an additional invite for yourself and accept it " + "on another device first, then retry.",
        officeName,
      ),
      {
        status: 409,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...securityHeaders({ tokenInUrl: false }),
        },
      },
    );
  }
  if (lookup) {
    await logoutBySessionHash(lookup.sessionIdHash);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": clearCookieHeader(),
      ...securityHeaders(),
    },
  });
}

function renderLockoutBlocked(message: string, officeName: string | null): string {
  return baseHtml(
    authPageTitle(officeName, "sign out blocked"),
    `<h1>Sign out blocked</h1>
    <p>${escapeHtml(message)}</p>
    <p><a href="/">Return to office</a></p>`,
  );
}

// /auth/* POSTs are exclusively browser-driven. Unlike the agent-API
// endpoints (which accept missing Origin from local curl), these require an
// explicit Origin match — except for the absent/`null` Origin case, where
// we fall back to the Fetch Metadata `Sec-Fetch-Site: same-origin` signal
// (browser-attested, not forgeable by page JS). The literal-`null` case
// happens on Chrome for top-level form POSTs from a page that sets
// `Referrer-Policy: no-referrer`; absent Origin is the broader
// legacy/privacy case. Empty-string Origin fails closed.
function hasSameOriginFetchMetadata(req: Request): boolean {
  return req.headers.get("sec-fetch-site") === "same-origin";
}
function originValidForAuthPost(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null || origin === "null") {
    return hasSameOriginFetchMetadata(req);
  }
  if (origin === "") return false;
  return checkOrigin(req);
}

// Top-level router used by index.ts: returns null when the path isn't an
// /auth/* path, so the caller falls through to its normal dispatch.
export async function tryHandleAuthRoute<T>(req: Request, url: URL, officeName: string | null, server: Server<T>): Promise<Response | null> {
  // Pre-claim tokenless flow. The server binds 127.0.0.1 pre-claim, so this
  // surface is unreachable from off-box; we still layer a strict same-origin
  // + loopback-peer-IP check on the POST as defense-in-depth in case the
  // bind is widened by operator override.
  if (req.method === "GET" && url.pathname === "/" && !hasOwner()) {
    return handleClaimForm(officeName);
  }
  if (req.method === "POST" && url.pathname === "/auth/claim") {
    return handleClaim(req, server, officeName);
  }
  // GET /i/<token> — peek + render accept page (NEVER consumes).
  if (req.method === "GET" && url.pathname.startsWith("/i/")) {
    const token = url.pathname.slice(3);
    if (!token) return renderInviteError("not_found", officeName);
    return handleInvitePeek(req, token, officeName);
  }
  if (url.pathname === "/auth/accept" && req.method === "POST") {
    return handleAccept(req, officeName);
  }
  if (url.pathname === "/auth/logout" && req.method === "POST") {
    return handleLogout(req, officeName);
  }
  return null;
}

// GET / when !hasOwner(): render the tokenless name-picker form. Routes
// here BEFORE the cookie gate. After claim, hasOwner() flips and this
// branch goes dead.
//
// The claim page uses `tokenInUrl: false` so `Referrer-Policy: no-referrer`
// is omitted: there's no token in the URL to leak, and Chrome's coupling
// between that header and `Origin: null` on top-level form POSTs would
// otherwise make the form's strict same-origin check reject the real
// browser submit with 403.
function handleClaimForm(officeName: string | null): Response {
  return new Response(renderClaimPage(null, officeName), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...securityHeaders({ tokenInUrl: false }),
    },
  });
}

// POST /auth/claim — consume the tokenless form, create the owner record,
// set the cookie. Locality is enforced at multiple layers:
//   1. The server bind (127.0.0.1 pre-claim) keeps off-box clients off the
//      TCP socket entirely;
//   2. requestIsLoopback rejects non-loopback peers if the bind has been
//      widened by operator override;
//   3. A strict same-origin check rejects ordinary browser POSTs from
//      pages on other origins (CSRF defense).
//
// The strict-Origin check does NOT close the "non-browser client forges
// Origin over a same-host proxy" case — curl can set Origin to anything,
// including the exact loopback value. This is an inherent topology limit;
// the documented mitigation is operator discipline (claim first, expose
// later — see docs/features/access-and-invites.md "Bootstrap-window
// exposure").
async function handleClaim<T>(req: Request, server: Server<T>, officeName: string | null): Promise<Response> {
  if (!requestIsLoopback(req, server)) {
    return new Response("forbidden", { status: 403 });
  }
  const origin = req.headers.get("origin");
  if (!origin || !isLoopbackOrigin(origin)) {
    return new Response("bad origin", { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const nameField = form?.get("name");
  const name = typeof nameField === "string" ? nameField : "";
  const ua = req.headers.get("user-agent");
  const result = await claimOwnership(name, { userAgent: ua });
  if (!result.ok) {
    const errorMsg =
      result.error === "owner_exists"
        ? "This office already has an owner. Refresh and sign in with an invite link instead."
        : "Please pick a display name (letters, numbers, spaces, periods, hyphens, apostrophes, or underscores).";
    return new Response(renderClaimPage(errorMsg, officeName), {
      status: 400,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...securityHeaders({ tokenInUrl: false }),
      },
    });
  }
  if (onOwnerCreated) {
    try {
      await onOwnerCreated({ username: result.username });
    } catch (err) {
      console.error("[auth] onOwnerCreated threw:", err);
    }
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": setCookieHeader(result.rawSessionId, result.absoluteExpiresAt),
      ...securityHeaders({ tokenInUrl: false }),
    },
  });
}

// Accept either http://localhost:<port> or http://127.0.0.1:<port> as the
// claim-form Origin. The browser sends whichever the operator typed.
function isLoopbackOrigin(origin: string): boolean {
  const port = process.env.PORT || "4000";
  return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
}

// ---------------------------------------------------------------------------
// HTML helpers. Kept inline to avoid a separate templating layer.

function renderLoginPage(officeName: string | null): string {
  const hasOfficeOwner = hasOwner();
  const body = `
    <main class="card">
      <h1>Bureau</h1>
      ${
        hasOfficeOwner
          ? `<p>This office requires an invite link.</p>
      <p>If the owner sent you a URL, open it. Each invite link signs you in on the device that opens it.</p>
      <p class="muted">If you don't have one, ask the office owner to issue one from the Access pane.</p>`
          : `<p>No owner has been set up for this office yet.</p>
      <p>Open <a href="/">this office's home page</a> to claim ownership.</p>
      <p class="muted">If you're trying to reach this office from another machine, you'll need to SSH-tunnel first (the claim form is only reachable from loopback). The server's startup log spells out the exact <code>ssh -L</code> command.</p>`
      }
    </main>
  `;
  return baseHtml(authPageTitle(officeName, "sign in"), body, undefined, PREAUTH_EXTRA_CSS);
}

// Tokenless first-time-setup form for the pre-claim flow. Shape mirrors
// renderAcceptPage's bootstrap branch (same display-name constraints, same
// "form must be submitted to take effect" anti-preview property) but without
// a token field since locality is the gate.
function renderClaimPage(errorMsg: string | null, officeName: string | null): string {
  const err = errorMsg ? `<p class="err">${escapeHtml(errorMsg)}</p>` : "";
  const og = {
    title: "Bureau — first-time setup",
    description: "Claim ownership of a new Bureau office.",
  };
  return baseHtml(
    authPageTitle(officeName, "first-time setup"),
    `
    <main class="card">
      <h1>Welcome to your new Bureau office</h1>
      <p>You're the first person to claim this office. Pick a display name; it'll appear next to anything you say.</p>
      <form method="POST" action="/auth/claim">
        <label>Display name <input name="name" type="text" autofocus maxlength="64" required pattern="[\\p{L}\\p{N} ._'\\-]+" /></label>
        ${err}
        <button type="submit">Continue</button>
      </form>
    </main>
    `,
    og,
    PREAUTH_EXTRA_CSS,
  );
}

const PREAUTH_EXTRA_CSS = `
  body {
    max-width: none;
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(120% 80% at 50% 0%, #fbeed6 0%, #f3dfb8 55%, #e5c98f 100%);
    color: #2a2418;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    position: relative;
    overflow: hidden;
  }
  @media (prefers-color-scheme: dark) {
    body {
      background:
        radial-gradient(120% 80% at 50% 0%, #2f2a22 0%, #221e18 55%, #15120e 100%);
      color: #e7dcc4;
    }
  }
  .card {
    position: relative;
    z-index: 1;
    background: rgba(255, 250, 240, 0.92);
    border: 1px solid rgba(110, 80, 36, 0.2);
    border-radius: 14px;
    padding: 32px 28px;
    max-width: 440px;
    width: 100%;
    box-shadow: 0 16px 48px rgba(0,0,0,0.12);
    backdrop-filter: blur(8px);
  }
  @media (prefers-color-scheme: dark) {
    .card {
      background: rgba(34, 28, 20, 0.92);
      border-color: rgba(220, 190, 130, 0.18);
      box-shadow: 0 16px 48px rgba(0,0,0,0.45);
    }
  }
  .card h1 {
    margin: 0 0 12px;
    font-size: 1.75rem;
  }
  .muted {
    color: #6a5530;
    font-size: 0.9em;
  }
  @media (prefers-color-scheme: dark) {
    .muted { color: #a88f60; }
  }
`;

function renderAcceptPage(token: string, needsName: boolean, errorMsg: string | null, officeName: string | null): string {
  const safeToken = escapeAttr(token);
  const err = errorMsg ? `<p class="err">${escapeHtml(errorMsg)}</p>` : "";
  const og = {
    title: needsName ? "Bureau — first-time setup" : "Bureau — accept invite",
    description: needsName ? "Open this link to claim ownership of a Bureau office." : "Open this link to sign in to a Bureau office on this device.",
  };
  if (needsName) {
    return baseHtml(
      authPageTitle(officeName, "first-time setup"),
      `
      <main class="card">
        <h1>Welcome to your new Bureau office</h1>
        <p>You're the first person to claim this office. Pick a display name — it'll appear next to anything you say.</p>
        <form method="POST" action="/auth/accept">
          <input type="hidden" name="token" value="${safeToken}" />
          <label>Display name <input name="name" type="text" autofocus maxlength="64" required pattern="[\\p{L}\\p{N} ._'\\-]+" /></label>
          ${err}
          <button type="submit">Continue</button>
        </form>
      </main>
      `,
      og,
      PREAUTH_EXTRA_CSS,
    );
  }
  const heading = officeName ? `Open your invite to the Bureau office: ${escapeHtml(officeName)}` : "Open your Bureau invite";
  return baseHtml(
    authPageTitle(officeName, "accept invite"),
    `
    <main class="card">
      <h1>${heading}</h1>
      <p>Clicking the button below will sign you in on this device.</p>
      <form method="POST" action="/auth/accept">
        <input type="hidden" name="token" value="${safeToken}" />
        ${err}
        <button type="submit" autofocus>Accept and continue</button>
      </form>
    </main>
    `,
    og,
    PREAUTH_EXTRA_CSS,
  );
}

function renderInviteError(kind: string, officeName: string | null): Response {
  const msg =
    kind === "consumed"
      ? "This invite has already been used."
      : kind === "expired"
        ? "This invite has expired."
        : kind === "role_mismatch"
          ? "This invite can't be accepted because the existing user has a different role. Ask the owner to mint a new invite."
          : kind === "owner_exists"
            ? "This office already has an owner. Bootstrap invites stop working once the office has been claimed."
            : "This invite is no longer valid.";
  const body = baseHtml(authPageTitle(officeName, "invite"), `<h1>Invite unavailable</h1><p>${escapeHtml(msg)}</p>`);
  return new Response(body, {
    status: 410, // Gone — invite was once valid (or never)
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...securityHeaders(),
    },
  });
}

function baseHtml(title: string, body: string, og?: { title: string; description: string }, extraCss: string = ""): string {
  const ogMeta = og
    ? `
<meta property="og:title" content="${escapeAttr(og.title)}" />
<meta property="og:description" content="${escapeAttr(og.description)}" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${escapeAttr(og.title)}" />
<meta name="twitter:description" content="${escapeAttr(og.description)}" />`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />${ogMeta}
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 480px; margin: 64px auto; padding: 0 16px; line-height: 1.5; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5em; }
  p { margin: 0.5em 0; }
  form { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
  label { display: flex; flex-direction: column; gap: 6px; }
  input[type=text] { padding: 8px; font-size: 1rem; border: 1px solid #888; border-radius: 4px; }
  button { padding: 8px 16px; font-size: 1rem; border-radius: 4px; cursor: pointer; }
  .err { color: #c33; }
${extraCss}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
