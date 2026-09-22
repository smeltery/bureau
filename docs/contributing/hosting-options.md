# Hosting Options

Bureau can run on the machine in front of you, on a private tailnet, behind a
public Tailscale Funnel URL, at your own domain, or on Render. Pick the smallest
setup that matches who needs access.

## Choose A Path

| Need                                    | Recommended path                  |
| --------------------------------------- | --------------------------------- |
| Try Bureau on this computer only        | Local development from the README |
| Reach Bureau from your own devices      | Private Tailscale                 |
| Share a public HTTPS office without DNS | Tailscale Funnel                  |
| Use your own domain and app subdomains  | Caddy with wildcard DNS           |
| Avoid managing a server                 | Render Blueprint                  |

All remote paths should start the same way: claim the office locally first,
then enable external access in `User Settings -> Access`, set the public URL,
save, and restart the Bureau service. Before the first owner exists, Bureau
binds to `127.0.0.1` only.

## Private Tailscale

Use this when every device and collaborator can join your tailnet.

1. Install Tailscale on the Bureau host and on each client device.
2. Claim Bureau from the host at `http://localhost:4000`.
3. Run Bureau as a persistent service; see [Self-Hosted Setup](self-hosted.md).
4. Enable external access with the tailnet URL, such as
   `http://my-office:4000`, then restart Bureau.
5. Test from a phone or laptop while connected to Tailscale.

For HTTPS on the tailnet, enable Tailscale HTTPS certificates and run:

```sh
sudo tailscale set --operator=$USER
tailscale serve --bg http://localhost:4000
```

Use the printed `https://...ts.net` address as Bureau's public URL. Tailscale
names do not provide wildcard app hostnames, so agent-built apps keep using
their host-and-port links.

## Public Tailscale Funnel

Use Funnel when you want a public HTTPS office without buying a domain or
opening router ports. Visitors do not need Tailscale, but they still need a
Bureau invite link.

Inspect existing mappings before changing anything:

```sh
tailscale serve status
tailscale funnel status
```

If port 443 already serves another application, decide what should own that
port before continuing. Then run Funnel yourself on the host:

```sh
tailscale funnel --bg http://localhost:4000
```

Approve the Tailscale authorization link if prompted, copy the public HTTPS
address from `tailscale funnel status`, set that URL in Bureau's external
access settings, restart Bureau, and test from a device with Wi-Fi and
Tailscale turned off.

Funnel exposes the office port only. It does not provide wildcard app hostnames,
so public app subdomains need the domain setup below.

## Own Domain With Caddy

Use this when you control a domain and want app hostnames such as
`notes.office.example.com`.

Prerequisites:

- A Linux host running Bureau with a stable public IPv4 address.
- Inbound TCP ports 80 and 443 allowed by the provider, router, and firewall.
- DNS records for `office.example.com` and `*.office.example.com` pointing at
  the host.

Install Caddy from its official package repository, then adapt this Caddyfile:

```caddyfile
{
    admin off
    on_demand_tls {
        ask http://127.0.0.1:4000/__bureau/tls-ask
    }
}

office.example.com {
    respond /__bureau/tls-ask 404
    reverse_proxy 127.0.0.1:4000
}

*.office.example.com {
    tls {
        on_demand
    }
    reverse_proxy 127.0.0.1:4000
}
```

Validate and restart Caddy:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

Set `https://office.example.com` as Bureau's public URL. Bureau's TLS ask route
allows certificates only for registered app names, so unknown wildcard hosts do
not get certificates just because they point at your server.

## Render

Render can run Bureau as one Docker web service with a persistent disk. Use the
root `render.yaml` as a Blueprint, set `BUREAU_PUBLIC_URL` to your office
domain, and add both the primary domain and wildcard domain in Render's custom
domain settings.

Only the disk mounted at `/var/data` survives deploys. Bureau stores office
state, provider profiles, app credentials, local logs, generated projects, and
checked-out repositories there.

See [Self-Hosted Setup](self-hosted.md#deploy-on-render) for the current Render
steps and [deploy/render/README.md](../../deploy/render/README.md) for adapter
details.

## Later Operations

- Invite people from `User Settings -> Access`.
- Connect provider accounts from `User Settings -> Connections`.
- Run `bun run doctor` after dependency changes, host moves, or browser-preview
  failures.
- Keep backups of `~/.bureau` or `BUREAU_HOME`; see
  [Backup And Restore](backup-restore.md).
