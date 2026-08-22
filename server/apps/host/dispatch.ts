// Host-based dispatch for registered apps: the one place that decides whether a
// request belongs to the office or to one of its apps, and the only way the
// app-host arm is ever entered.
//
// The office's request entry point calls this FIRST, before the URL is parsed
// and before any route runs:
//
//   null      -> not an app host. Fall through to the office, unchanged. Every
//                existing route is downstream of this, so the fall-through is
//                the load-bearing half.
//   Response  -> diverted. The office handler must not run.
//
// CONTAINMENT IS THE SECURITY PROPERTY. App hostnames sit under a wildcard
// record, so anyone can point any name under it at this server, and none of
// those names may reach the office's own surface. A diverted request is
// answered here or refused here — never handed onward.
//
// WHERE THE DOMAIN COMES FROM: the office's public origin, and nothing else. No
// config key, no override, no installer-written state. The consequence, accepted
// deliberately: an operator who has some other record pointed at this office
// under that name (`www.`, `staging.`) stops getting the office there and gets a
// neutral 404, because an unknown label cannot be allowed to fall through.
// Loopback and plain-HTTP offices — every dev box — get no app-host domain at
// all and are byte-identical to before this existed.

import { appRegistry as productionRegistry, type AppRegistry } from "../registry.ts";
import { appSupervisor as productionSupervisor, type AppSupervisor } from "../supervisor.ts";
import { appHostDomain } from "../domain.ts";
import { matchAppHost, normalizeRequestHost } from "./match.ts";
import { APP_AUTH_PATH, APP_RESERVED_PATH } from "./auth-cookie.ts";
import { appHostAuthGate, appHostWsAuthGate, handleAppAuthRedeem } from "./auth.ts";
import { APP_FAVICON_PATH, appFavicon } from "./favicon.ts";
import { neutralNotFound } from "./responses.ts";
import { relayToApp } from "./proxy.ts";
import { relayWsToApp, type AppRelayWsData } from "./ws-relay.ts";
import type { AppRecord } from "../../../shared/apps.ts";

// A WebSocket handshake is a GET (RFC 6455 section 4.1). Any other method
// carrying an `Upgrade` header is not one, and is left to the HTTP relay — which
// drops `Upgrade` as hop-by-hop, so the app sees an ordinary request rather than
// a half-understood upgrade attempt.
function isWebSocketUpgrade(req: Request): boolean {
  return req.method === "GET" && req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

// What the arm needs from the process around it. The SUPERVISOR is the reason
// this is an object rather than a bare registry argument: systemd is
// machine-global, so the arm has to use the instance the server was started with
// (a fake, under `bun test`) and never the production singleton.
export interface AppHostDeps {
  registry?: AppRegistry;
  supervisor?: AppSupervisor;
  // The office's app-host domain. Injected so a test can drive the whole arm
  // without booting a server to freeze one.
  domain?: string | null;
  // The TCP peer of the office's listener, for X-Forwarded-For, read only if a
  // request is actually relayed.
  peer?: () => string | null | undefined;
  // Hands a request to the runtime as a WebSocket. Supplied by the office, which
  // is the only place that holds the Bun server; absent means this office cannot
  // upgrade anything, and an upgrade on an app host is refused rather than
  // half-performed.
  upgrade?: (req: Request, data: AppRelayWsData, headers?: Headers) => boolean;
}

// DELIBERATELY NOT `async`. Only the diverted path returns a promise; the
// office's own path — every request of every install without app hostnames —
// stays synchronous, and the caller awaits whatever it gets back. The WebSocket
// branch is the one that can resolve to `undefined`: a request that became a
// socket has no response, which is what the runtime expects back.
export function handleAppHostRequest(req: Request, deps: AppHostDeps = {}): Response | Promise<Response | undefined> | null {
  const domain = deps.domain !== undefined ? deps.domain : appHostDomain();
  if (domain === null) return null;

  const host = normalizeRequestHost(req.headers.get("host"));
  if (host === null) return null;

  const match = matchAppHost(host, domain);
  if (match === null) return null;

  // Everything below here is DIVERTED. No office handler sees this request.
  if (match.kind === "under") return neutralNotFound();

  // ONE snapshot, used for both questions asked of the registry: which app owns
  // this label, and (in the relays) which names to ask the supervisor about. A
  // second read would be a second answer.
  const registry = deps.registry ?? productionRegistry;
  let apps: readonly AppRecord[];
  try {
    apps = registry.list();
  } catch (err) {
    // A registry that cannot be read cannot vouch for a label. Fail closed: the
    // same 404 an unknown label gets, never an app.
    console.error("[app-hosts] app registry unreadable; refusing host:", err);
    return neutralNotFound();
  }
  // The app record, not just a boolean: the handshake binds a session to the
  // app's issuance TUPLE (label plus generation), which is what the registry
  // treats as an app's identity. A retired label and one never issued are the
  // SAME 404 — the difference is not the internet's business.
  const app = apps.find((a) => a.hostLabel === match.label) ?? null;
  if (app === null) return neutralNotFound();

  const { pathname } = new URL(req.url);
  const upgrade = isWebSocketUpgrade(req);

  // Browsers ask for a favicon outside the page's own request flow. Give every
  // registered app a recognizable Bureau icon before auth and proxying, with a
  // stable per-app color so several app tabs remain easy to tell apart. Unknown
  // and retired labels have already returned the same neutral 404 above.
  if (!upgrade && pathname === APP_FAVICON_PATH && (req.method === "GET" || req.method === "HEAD")) {
    return appFavicon(app);
  }

  // The reserved namespace, checked AHEAD of the WebSocket branch: an upgrade is
  // a GET and the handshake's own path answers GETs, so with the order the other
  // way round an upgrade addressed at the auth path would redeem a sign-in code
  // and then be relayed. The reserved namespace is not the app's, by any method
  // and by any protocol — both relays plug in below this branch.
  if (pathname === APP_RESERVED_PATH || pathname.startsWith(`${APP_RESERVED_PATH}/`)) {
    if (!upgrade && pathname === APP_AUTH_PATH && req.method === "GET") {
      return handleAppAuthRedeem(req, { host, app });
    }
    return neutralNotFound();
  }

  const supervisor = deps.supervisor ?? productionSupervisor;

  if (upgrade) {
    // Auth first, in the same position as the HTTP path's gate — but with its own
    // answer, because an upgrade cannot follow the redirect that gate would hand
    // it. Handled HERE rather than by falling through: falling through would give
    // a diverted host to the office's own /ws handler, which is the one thing
    // that must be impossible.
    const wsGate = appHostWsAuthGate(req, { host, app });
    if (wsGate !== null) return wsGate;
    return relayWsToApp(req, {
      app,
      host,
      apps,
      supervisor,
      peer: deps.peer,
      upgrade: (request, data, headers) => {
        // No upgrade seam, no upgrade: an office that did not supply one cannot
        // hand a socket to anything, and pretending otherwise would 101 a
        // browser into a connection nobody is holding.
        if (deps.upgrade === undefined) return false;
        return deps.upgrade(request, data, headers);
      },
    });
  }

  const gate = appHostAuthGate(req, { host, app });
  if (gate !== null) return gate;

  return relayToApp(req, { app, host, apps, supervisor, peer: deps.peer });
}
