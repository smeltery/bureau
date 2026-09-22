# Run A Public Office With Tailscale Funnel

Use this path when you want a public HTTPS Bureau address without buying a
domain or opening router ports. Visitors do not need Tailscale, but they still
need a Bureau invite link.

Start from [Private Tailscale](private.md) through the Bureau install, first
owner claim, and systemd service setup.

## Make The Office Public

Funnel depends on Tailscale's service and bandwidth limits. Sign in as a
Tailscale owner, admin, or network admin for the authorization step.

Inspect existing mappings before changing anything:

```sh
tailscale serve status
tailscale funnel status
```

A port is all-private Serve or all-public Funnel. If port 443 has mappings
besides Bureau at `localhost:4000`, decide what should own the port before you
continue.

```sh
tailscale funnel --bg http://localhost:4000
```

If the command prints an authorization link, open it and approve enabling
Funnel. Copy the public HTTPS address from the output or from
`tailscale funnel status`.

In Bureau, open `User Settings -> Access`, enable external access, set the
Funnel URL, save, and restart the service:

```sh
systemctl --user restart bureau
```

Test the URL on a phone with Wi-Fi and Tailscale turned off. A request from the
server itself does not prove public access works.

## Apps

Funnel exposes the office port only. It does not provide wildcard app hostnames,
so public app subdomains need the domain setup. App port links remain usable
from devices with direct or private Tailscale access to the server.

