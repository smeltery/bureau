import type { Server } from "bun";
import { hasOwner } from "../users.ts";
import { claimOwnership, setCookieHeader } from "./auth.ts";
import { renderClaimPage, securityHeaders } from "./auth-pages.ts";
import { isLoopbackOrigin, requestIsOnBox } from "./auth-request-guards.ts";

type OwnerCreatedCb = (opts: { username: string }) => Promise<void> | void;

export function shouldShowClaimForm(req: Request, url: URL): boolean {
  return req.method === "GET" && url.pathname === "/" && !hasOwner();
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
export function handleClaimForm(officeName: string | null): Response {
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
//   2. requestIsOnBox rejects non-loopback peers if the bind has been
//      widened by operator override, and loopback requests that carry a
//      forwarding header (a same-host proxy such as Caddy or `tailscale
//      serve` relaying an outside client);
//   3. A strict same-origin check rejects ordinary browser POSTs from
//      pages on other origins (CSRF defense).
//
// A same-host proxy that adds no forwarding header at all is still
// indistinguishable from a local process; the documented mitigation is
// operator discipline (claim first, expose later — see
// docs/features/access-and-invites.md "Bootstrap-window exposure").
export async function handleClaim<T>(req: Request, server: Server<T>, officeName: string | null, onOwnerCreated: OwnerCreatedCb | null): Promise<Response> {
  if (!requestIsOnBox(req, server)) {
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
