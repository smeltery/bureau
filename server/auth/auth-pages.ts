import { hasOwner } from "../users.ts";
import { buildPublicOrigin } from "./auth.ts";

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

export function renderLockoutBlocked(message: string, officeName: string | null): string {
  return baseHtml(
    authPageTitle(officeName, "sign out blocked"),
    `<h1>Sign out blocked</h1>
    <p>${escapeHtml(message)}</p>
    <p><a href="/">Return to office</a></p>`,
  );
}

// Browser-tab title for /auth/* and /i/<token> pages.
function authPageTitle(officeName: string | null, suffix: string): string {
  return officeName ? `${officeName} | Bureau — ${suffix}` : `Bureau — ${suffix}`;
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
