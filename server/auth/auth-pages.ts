import { hasOwner } from "../users.ts";
import { deriveAppHostDomain } from "../apps/domain.ts";
import { buildPublicOrigin } from "./auth.ts";
import { escapeAttr, escapeHtml } from "./auth-html.ts";
import { authDocument, errorHtml, nameInput, type AuthPageError } from "./preauth/document.ts";
import type { SupportedLanguageCode } from "../../shared/languages.ts";
import type { PlainMessageKey } from "../../shared/i18n/translate.ts";

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

export function renderLoginPage(officeName: string | null, language: SupportedLanguageCode = "en"): string {
  const owner = hasOwner();
  return authDocument(
    officeName,
    "preauth.signIn",
    (t) =>
      `<h1>Bureau</h1>${
        owner
          ? `<p>${escapeHtml(t("preauth.requiresInvite"))}</p><p>${escapeHtml(t("preauth.openLink"))}</p><p class="muted">${escapeHtml(t("preauth.askOwner"))}</p>`
          : `<p>${escapeHtml(t("preauth.noOwner"))}</p><p><a href="/">${escapeHtml(t("preauth.home"))}</a></p><p class="muted">${escapeHtml(t("preauth.tunnel"))}</p>`
      }`,
    language,
  );
}

export function renderClaimPage(error: AuthPageError, officeName: string | null, language: SupportedLanguageCode = "en", name = ""): string {
  return authDocument(
    officeName,
    "preauth.setup",
    (t) => `<h1>${escapeHtml(t("preauth.welcome"))}</h1><p>${escapeHtml(t("preauth.pickName"))}</p>
    <form method="POST" action="/auth/claim">${nameInput(t, name)}${errorHtml(error, t)}<button type="submit">${escapeHtml(t("preauth.continue"))}</button></form>`,
    language,
    "preauth.setupDescription",
  );
}

export function renderAcceptPage(token: string, needsName: boolean, error: AuthPageError, officeName: string | null, language: SupportedLanguageCode = "en", name = ""): string {
  return authDocument(
    officeName,
    needsName ? "preauth.setup" : "preauth.acceptTitle",
    (t) => {
      const heading = needsName ? t("preauth.welcome") : officeName ? t("preauth.openNamedInvite", { office: officeName }) : t("preauth.openInvite");
      return `<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(t(needsName ? "preauth.pickName" : "preauth.clickHint"))}</p>
      <form method="POST" action="/auth/accept"><input type="hidden" name="token" value="${escapeAttr(token)}" />
      ${needsName ? nameInput(t, name) : ""}${errorHtml(error, t)}<button type="submit"${needsName ? "" : " autofocus"}>${escapeHtml(t(needsName ? "preauth.continue" : "preauth.accept"))}</button></form>`;
    },
    language,
    needsName ? "preauth.setupDescription" : "preauth.inviteDescription",
  );
}

export function renderInviteError(kind: string, officeName: string | null, language: SupportedLanguageCode = "en"): Response {
  const keys: Record<string, PlainMessageKey> = { consumed: "preauth.consumed", expired: "preauth.expired", role_mismatch: "preauth.roleMismatch", owner_exists: "preauth.bootstrapUsed" };
  const key = Object.hasOwn(keys, kind) ? keys[kind] : "preauth.invalid";
  return new Response(
    authDocument(officeName, "preauth.inviteTitle", (t) => `<h1>${escapeHtml(t("preauth.unavailable"))}</h1><p>${escapeHtml(t(key))}</p>`, language),
    {
      status: 410,
      headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() },
    },
  );
}

export function renderInviteIdentityConflict(conflict: { current: string; invitee: string }, officeName: string | null, language: SupportedLanguageCode = "en"): Response {
  return new Response(
    authDocument(
      officeName,
      "preauth.inviteTitle",
      (t) => `<h1>${escapeHtml(t("preauth.conflict"))}</h1>
    <p>${escapeHtml(t("preauth.conflictBody", conflict))}</p><p><a href="/">${escapeHtml(t("preauth.return"))}</a></p>`,
      language,
    ),
    {
      status: 409,
      headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() },
    },
  );
}

export function renderLockoutBlocked(message: AuthPageError, officeName: string | null, language: SupportedLanguageCode = "en"): string {
  return authDocument(officeName, "preauth.blocked", (t) => `<h1>${escapeHtml(t("preauth.blocked"))}</h1>${errorHtml(message, t)}<p><a href="/">${escapeHtml(t("preauth.return"))}</a></p>`, language);
}
