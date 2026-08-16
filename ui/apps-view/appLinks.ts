// Where an app's name links to.
//
// An app the office has issued a hostname to carries its own `url`, and that is
// used verbatim. Everything below is about the fallback — the port link an
// office without app hostnames gets.
//
// Pure: no DOM, no server.

import type { AppWire } from "../../shared/apps.ts";

// Tailscale's MagicDNS namespace. An office served at a tailnet name answers on
// HTTPS, so the browser upgrades an http link built from that name (cached HSTS
// or auto-upgrade) and it never reaches an app port serving plain http. The
// node's SHORT name carries no https history and resolves on the tailnet, so a
// port link is built from it instead.
//
// The suffix is matched on the LABEL boundary — the same rule as isTailnetName
// in server/apps/domain.ts — so `myts.net` and `ts.net.example.com` are ordinary
// domains. The classification is deliberately not identical: that one counts the
// bare apex as tailnet to refuse deriving children, while here the apex carries
// no node label to shorten to, so it is left unchanged.
const TAILNET_SUFFIX = "ts.net";

function portLinkHost(officeHostname: string): string {
  const host = officeHostname.toLowerCase().replace(/\.$/, "");
  if (!host.endsWith(`.${TAILNET_SUFFIX}`)) return officeHostname;
  const node = host.slice(0, host.indexOf("."));
  return node || officeHostname;
}

/**
 * Where the app's name links to. `url` is the office's own answer — the full
 * https origin the app answers on, present exactly when the office has app
 * hostnames at all — so it is used verbatim and nothing about it is derived
 * here. Without one, the link stays what it has always been: this office's host
 * with the app's port, which only reaches the app from inside the box's network
 * — shortened to the node name on a tailnet office, where the long name would be
 * upgraded to https (see portLinkHost). Every other hostname is passed through
 * unchanged.
 *
 * The empty-string check is a boundary fail-safe, not a contract: the wire omits
 * `url` rather than sending "", and an empty href would silently link the row to
 * the page it is already on.
 */
export function appHref(app: Pick<AppWire, "url" | "port">, officeHostname: string): string {
  if (typeof app.url === "string" && app.url !== "") return app.url;
  return `http://${portLinkHost(officeHostname)}:${app.port}/`;
}

export function appLinkLabel(app: Pick<AppWire, "url">): string {
  return typeof app.url === "string" && app.url !== "" ? "Open app" : "Open on this network";
}
