# Run An Office At Your Own Domain

Use this path when you control a domain and want Bureau plus agent-built app
subdomains, such as `notes.office.example.com`.

You need a Linux host running Bureau, a public IP address that accepts inbound
TCP ports 80 and 443, and DNS records for the office and wildcard app names.
If your internet provider uses carrier-grade NAT, use Funnel or a VPS instead.

Start from [Private Tailscale](private.md) through the Bureau install, first
owner claim, and systemd service setup.

## Point DNS At The Host

1. Give the host a stable local address, using a router DHCP reservation for
   home hardware or a static provider address for a server.
2. Forward TCP ports 80 and 443 to the host, or allow them in the provider
   firewall.
3. Add an A record for `office.example.com` and an A record for
   `*.office.example.com`, both pointing at the public IPv4 address.
4. Keep port 4000 and app ports closed to the public internet.

Replace `office.example.com` below with your chosen hostname.

## Configure Caddy

Install Caddy from its official package repository, then use this Caddyfile:

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

Caddy obtains certificates automatically. Bureau's TLS ask route allows
certificates only for registered app names.

## Finish Bureau Setup

Use `https://office.example.com` as the public URL in
`User Settings -> Access`, save, and restart Bureau:

```sh
systemctl --user restart bureau
```

Check the address from a phone on cellular data. If it fails, check DNS, router
forwarding, firewalls, and `sudo journalctl -u caddy -n 50 --no-pager`.

Registered apps get separate HTTPS addresses under the wildcard domain.

