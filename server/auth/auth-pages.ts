import { hasOwner } from "../users.ts";
import { deriveAppHostDomain } from "../apps/domain.ts";
import { buildPublicOrigin } from "./auth.ts";
import { PREAUTH_EXTRA_CSS, authPageTitle, baseHtml, escapeAttr, escapeHtml } from "./auth-html.ts";

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
//   Content-Security-Policy / X-Content-Type-Options / X-Frame-Options /
//   Permissions-Policy
//     Baseline browser hardening for the office shell, auth pages, public
//     assets, and JSON error responses. The CSP permits the app-preview frame
//     wildcard only when this boot has an app-host domain.
//
//   Strict-Transport-Security (HTTPS only)
//     HSTS protects later requests that start over HTTP. `includeSubDomains`
//     is NOT set to avoid pinning sibling subdomains on shared parent
//     domains.
export function securityHeaders(opts?: { tokenInUrl?: boolean }): Record<string, string> {
  const tokenInUrl = opts?.tokenInUrl ?? true;
  const { origin, isHttps } = buildPublicOrigin();
  const frameSources = ["'self'", "blob:", "data:"];
  const appDomain = deriveAppHostDomain(origin, isHttps);
  if (appDomain) frameSources.push(`https://*.${appDomain}`);
  const h: Record<string, string> = {
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self' ws: wss:",
      "font-src 'self' data:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      `frame-src ${frameSources.join(" ")}`,
      "img-src 'self' data: blob:",
      "object-src 'none'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      ...(isHttps ? ["upgrade-insecure-requests"] : []),
    ].join("; "),
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(self), payment=(), usb=()",
    "Referrer-Policy": tokenInUrl ? "no-referrer" : "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
  if (isHttps) {
    h["Strict-Transport-Security"] = "max-age=31536000";
  }
  return h;
}

const ACTIVE_FILE_TYPES = new Set(["text/html", "image/svg+xml", "text/xml", "application/xml"]);

// Headers for a file an agent or member put in chat. The office serves it from
// its own origin, so an opened HTML or SVG file would otherwise run as office
// content with the viewer's session. `sandbox` without allow-same-origin gives
// the page an opaque origin: its scripts still run, but the browser sends no
// session cookie for it and the socket upgrade rejects its `null` Origin. Only
// active types get the sandbox: Chrome's PDF viewer refuses to render in a
// sandboxed document, and nosniff keeps every other type from turning active.
// withSecurityHeaders keeps a header that is already set, so this policy
// replaces the office one on these responses.
//
// The cache is private because access is checked per viewer, and not immutable
// because storage pruning can free a filename for different bytes later.
export function untrustedFileHeaders(contentType: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-cache",
  };
  if (ACTIVE_FILE_TYPES.has(contentType)) {
    headers["Content-Security-Policy"] = `${securityHeaders()["Content-Security-Policy"]}; sandbox allow-scripts`;
  }
  return headers;
}

export function withSecurityHeaders(response: Response): Response {
  const headers = securityHeaders({ tokenInUrl: false });
  for (const [name, value] of Object.entries(headers)) {
    if (!response.headers.has(name)) response.headers.set(name, value);
  }
  return response;
}

export function renderLoginPage(officeName: string | null): string {
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
export function renderClaimPage(errorMsg: string | null, officeName: string | null): string {
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

export function renderAcceptPage(token: string, needsName: boolean, errorMsg: string | null, officeName: string | null): string {
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

export function renderInviteError(kind: string, officeName: string | null): Response {
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

export function renderInviteIdentityConflict(conflict: { current: string; invitee: string }, officeName: string | null): Response {
  const body = baseHtml(
    authPageTitle(officeName, "invite"),
    `<h1>This invite is for a different user</h1>
    <p>${escapeHtml(`You are signed in as ${conflict.current}. This invite is for ${conflict.invitee}: open it on their device or in a separate browser profile.`)}</p>
    <p><a href="/">Return to office</a></p>`,
    undefined,
    PREAUTH_EXTRA_CSS,
  );
  return new Response(body, {
    status: 409,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...securityHeaders(),
    },
  });
}

export function renderLockoutBlocked(message: string, officeName: string | null): string {
  return baseHtml(
    authPageTitle(officeName, "sign out blocked"),
    `<h1>Sign out blocked</h1>
    <p>${escapeHtml(message)}</p>
    <p><a href="/">Return to office</a></p>`,
  );
}
