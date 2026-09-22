# Set Up Bureau On A Fresh VPS

Use this path for a fresh Ubuntu or Debian server with a public IP address and
a domain you control. Bureau does not currently ship the upstream Isomux
installer, so this guide uses the manual Bureau service plus Caddy setup.

## Create The Server And DNS

1. Create a fresh Ubuntu server with your SSH public key.
2. Allow inbound TCP ports 80 and 443, and SSH only from your administration
   device where possible.
3. Add A records for `office.example.com` and `*.office.example.com` pointing
   at the server IP.
4. SSH into the server.

## Install Bureau

Follow [Private Tailscale](private.md#install-bureau) for packages, Bun,
`bun install`, `bun run build:ui`, and `bun run doctor`.

Claim the first owner at `http://localhost:4000` by forwarding the port from
your laptop:

```sh
ssh -L 4000:localhost:4000 USER@SERVER_IP
```

Then open `http://localhost:4000` locally and create the owner.

## Add Service And Domain

Set up the systemd user service from
[Private Tailscale](private.md#keep-it-running), then configure Caddy with
[Own Domain](domain.md#configure-caddy).

Use `https://office.example.com` as the public URL in
`User Settings -> Access`, save, and restart the service:

```sh
systemctl --user restart bureau
```

## Operations

- Office logs: `journalctl --user -u bureau -n 50 --no-pager`
- Caddy logs: `sudo journalctl -u caddy -n 50 --no-pager`
- Health check: `bun run doctor`
- Backups: keep copies of `~/.bureau` or `BUREAU_HOME`, plus generated project
  directories you care about.

