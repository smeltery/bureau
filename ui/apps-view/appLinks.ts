// Where an app's name links to.
//
// Tailscale's MagicDNS namespace. An office served at a tailnet name answers on
// HTTPS, so the browser upgrades an http link built from that name (cached HSTS
// or auto-upgrade) and it never reaches an app port serving plain http. The
// node's SHORT name carries no https history and resolves on the tailnet, so a
// port link is built from it instead.
//
// The suffix is matched on the LABEL boundary, so `myts.net` and
// `ts.net.example.com` are ordinary domains. The bare apex is left unchanged
// too: it carries no node label to shorten to.
const TAILNET_SUFFIX = "ts.net";

function portLinkHost(officeHostname: string): string {
  const host = officeHostname.toLowerCase().replace(/\.$/, "");
  if (!host.endsWith(`.${TAILNET_SUFFIX}`)) return officeHostname;
  const node = host.slice(0, host.indexOf("."));
  return node || officeHostname;
}

/**
 * Where the app's name links to: this office's host with the app's port, which
 * only reaches the app from inside the box's network — shortened to the node
 * name on a tailnet office, where the long name would be upgraded to https
 * (see portLinkHost). Every other hostname is passed through unchanged.
 *
 * PORT LINKS ONLY, for now. Bureau has no app hostnames yet; when the app-host
 * arm lands, an app will carry its own `url` (the full https origin it answers
 * on, computed by the office from its public origin and the app's issued label)
 * and that must be used verbatim in preference to anything derived here.
 */
export function appHref(app: { port: number }, officeHostname: string): string {
  return `http://${portLinkHost(officeHostname)}:${app.port}/`;
}
