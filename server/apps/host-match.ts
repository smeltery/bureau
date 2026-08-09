// Which hostname a request is for: the office's own, or one of its apps'.
//
// An office serves one hostname. Once registered apps get stable origins a
// second class arrives, and the URL shape is FLAT — an app called `hello` on an
// office at `office.example` answers at `hello.office.example`. The office and
// its apps are one namespace, parent and children, and the first thing the
// request handler must decide is which it is looking at, because the two get
// entirely different treatment:
//
//   - the office's own host, or anything outside it -> not ours: the office
//     dispatches exactly as it always has. Every existing route is downstream
//     of this, so the fall-through is the load-bearing half.
//   - a strict child -> diverted, and NO office handler ever sees the request.
//     That containment is the security property: app hostnames sit under a
//     wildcard record, so anyone can point any name under it at this server,
//     and none of those names may reach the office's own surface.
//
// Pure, and a leaf: both the dispatcher and the certificate-admission gate
// (tls-ask.ts) decide with the same two functions, so a name that could not be
// ROUTED to an app can never be CERTIFIED for one either.

import { isHostname } from "./domain.ts";

// Every code point a hostname may carry before any structural check. Anything
// outside printable ASCII — C0 controls, DEL, and all non-ASCII including IDN —
// is refused here rather than sneaking into a label test. Deliberately NOT
// doing IDNA conversion: a non-ASCII Host can never equal an ASCII office host,
// and A-labels (`xn--...`) are already ASCII and match literally.
function isPrintableAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

// The `Host` request header, reduced to something comparable with the office
// host. Returns null when the header is absent or cannot be a hostname we route
// on — which for the dispatcher means "not ours", i.e. today's office behavior,
// never a refusal.
export function normalizeRequestHost(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (!isPrintableAscii(raw)) return null;
  // Host is case-insensitive and the office host is stored lowercase, so the
  // fold happens here, once, before anything compares strings.
  let host = raw.toLowerCase();
  // An IPv6 literal arrives bracketed (`[::1]:4000`). It can never be an app
  // host, and its colons would confuse the port split below.
  if (host.startsWith("[")) return null;
  const colon = host.indexOf(":");
  if (colon !== -1) {
    const port = host.slice(colon + 1);
    host = host.slice(0, colon);
    // Syntax only — the port's VALUE is irrelevant, we route on the name. An
    // empty port, a non-numeric one, or a second colon is a malformed Host.
    if (!/^[0-9]+$/.test(port)) return null;
  }
  // Exactly one trailing dot (the FQDN form). `name..` keeps an empty label and
  // is rejected by isHostname.
  if (host.endsWith(".")) host = host.slice(0, -1);
  return isHostname(host) ? host : null;
}

export type AppHostMatch =
  // Exactly one label below the office host: a candidate app.
  | { kind: "label"; label: string }
  // More than one label below it. Diverted like any other app host — it is
  // inside the wildcard — but it can never name an app.
  | { kind: "under" };

// `host` must already be through normalizeRequestHost: everything compared here
// is a canonical lowercase name with no port and no trailing dot.
export function matchAppHost(host: string, domain: string): AppHostMatch | null {
  // ONLY strict children divert. That single test is also what keeps the office
  // reachable: the office host IS the domain, and a string never ends with a
  // longer string, so the office can never match here. There is no separate
  // exemption for it because there is nothing to exempt — worth knowing before
  // anyone adds one back and assumes it is load-bearing.
  if (!host.endsWith(`.${domain}`)) return null;
  const label = host.slice(0, host.length - domain.length - 1);
  if (label.length === 0 || label.includes(".")) return { kind: "under" };
  // No exception list here, deliberately. A name that cannot be REGISTERED as an
  // app (the registry's reserved list) does not therefore route to the office:
  // registry refusal and HTTP routing are separate invariants, and an unknown
  // label reaching the office is the hole this arm exists to close.
  return { kind: "label", label };
}
