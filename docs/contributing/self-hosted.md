# Self-Hosted Setup

Bureau can run as an always-on local service on a Mac mini, Linux box, or
other machine you keep online. The setup has three parts: keep the server
running, make it reachable from the devices and people who need it, and use
invite-link auth to control access.

## Keep It Running

For Linux hosts, create a systemd user service that rebuilds the UI on start,
starts `bun run server/index.ts`, restarts on failure, and enables lingering so
the service survives logout.

A typical agent prompt for doing that from inside Bureau:

```text
Set up Bureau as an always-on server. Create a systemd user service that
auto-rebuilds the UI on start and restarts on failure. Enable lingering so it
survives logout. Verify the service is running before you finish.
```

On macOS, use a launchd agent instead. On Windows, use Task Scheduler or a
service wrapper.

## Make It Reachable

Bureau starts on `localhost:4000`. Before exposing it to another device, claim
the office locally first. Pre-claim, the server binds `127.0.0.1` only, so
remote devices should not be able to connect until ownership exists and
external access is enabled.

The recommended paths are documented in
[Access & Invites](../features/access-and-invites.md):

- **Tailscale Funnel** for a public HTTPS URL without router port forwarding.
- **Tailscale tailnet-only** for private access from your own devices.
- **Caddy + your own DNS** when you want a conventional public hostname.

After the office is claimed, open `User Settings -> Access`, enable external
access, set the public URL, save, and restart the Bureau service.

## Mobile And PWA

Once Bureau is reachable from a phone, install it as a PWA:

- **iPhone:** Safari -> Share -> Add to Home Screen.
- **Android:** Chrome prompts to install on first visit when the origin is
  HTTPS or localhost.

Voice input and Android PWA install require a secure context: HTTPS or
localhost. Tailscale Funnel already provides HTTPS. For private tailnet HTTPS,
enable MagicDNS and HTTPS certificates in Tailscale, then run:

```sh
sudo tailscale set --operator=$USER
tailscale serve --bg http://localhost:4000
```

## Authorize Users

Bureau gates browser HTTP and WebSocket traffic with a session cookie. There
are no external accounts or passwords.

To grant access, mint a single-use invite link in `User Settings -> Access`
and send it out of band. Owners can invite new identities. Members can mint
self-invites for their own additional devices. Every authenticated user should
be trusted with shell-equivalent access to the host.

## Backups

Bureau writes state under `~/.bureau/` or `BUREAU_HOME`. Daily backup tarballs
are written to `~/bureau-backups/` by default, with the last seven retained.
For manual restore, stop the service, move the current state directory aside,
extract the chosen backup into the home directory, then restart Bureau.
