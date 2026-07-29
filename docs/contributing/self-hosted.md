# Self-Hosted Setup

Bureau can run as an always-on local service on a Mac mini, Linux box, or
other machine you keep online. The setup has three parts: keep the server
running, make it reachable from the devices and people who need it, and use
invite-link auth to control access.

## Keep It Running

For Linux hosts, create a systemd user service that rebuilds the UI on start,
starts `bun run server/index.ts`, restarts on failure, and enables lingering so
the service survives logout. A template is available at
[`bureau.service.example`](bureau.service.example).

```sh
mkdir -p ~/.config/systemd/user
cp docs/contributing/bureau.service.example ~/.config/systemd/user/bureau.service
$EDITOR ~/.config/systemd/user/bureau.service   # set WorkingDirectory to this checkout
systemctl --user daemon-reload
systemctl --user enable --now bureau
sudo loginctl enable-linger "$USER"
systemctl --user status bureau
```

Restarting this service interrupts active agents because the server process owns
their backend sessions. Wait for agents to become idle before planned restarts
when you do not want to cut off in-progress turns.

For this user-service setup, restart with:

```sh
systemctl --user restart bureau
```

If you adapt the unit into a root-managed system service instead, use the
system service form:

```sh
sudo systemctl restart bureau
```

A typical agent prompt for doing that from inside Bureau:

```text
Set up Bureau as an always-on server. Create a systemd user service that
auto-rebuilds the UI on start and restarts on failure. Enable lingering so it
survives logout. Verify the service is running before you finish.
```

On macOS, use a launchd agent instead. On Windows, use Task Scheduler or a
service wrapper.

## Fresh Ubuntu VPS

On a minimal Ubuntu or Debian host, install the native build tools before
running `bun install`. Bureau's terminal panel uses `node-pty` through a small
Node sidecar, so Node and the C/C++ build chain need to be present even though
Bureau itself runs on Bun.

```sh
sudo apt-get update
sudo apt-get install -y git curl ca-certificates build-essential python3 make g++ nodejs
curl -fsSL https://bun.sh/install | bash
exec "$SHELL" -l
git clone https://github.com/dotbrains/bureau.git ~/bureau
cd ~/bureau
bun install
bun run build:ui
bun run doctor
```

If your distribution's `nodejs` package is too old for `node-gyp` or
`node-pty`, install a current Node.js release from NodeSource, your package
manager of choice, or `nvm`, then rerun `bun install`. On Debian/Ubuntu, one
NodeSource path is:

```sh
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
  sudo gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" |
  sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
sudo apt-get update
sudo apt-get install -y nodejs
bun install
```

Use Tailscale, a reverse proxy, or a firewall rule so only intended users can
reach port `4000`. Claim the office locally before enabling external access.

## Health Check

Run the install doctor after dependency changes, host moves, or failed preview
or terminal sessions:

```sh
bun run doctor
```

It checks:

- Bun is the runtime executing Bureau.
- Node is available and can load `node-pty`.
- A Chrome-family browser is available for optional browser preview cards.
- `~/.bureau` or `BUREAU_HOME` is writable.
- Git metadata is available for update notices.

`WARN` lines identify optional or degraded capabilities. `FAIL` lines need to
be fixed before considering the host healthy.

## Browser Preview Cards

Bureau can let agents capture screenshots of local or private development URLs
and attach them to chat as preview cards. Install a Chrome-family browser on the
host if you want agents to use `POST /api/agents/:id/preview-url`.

On Debian/Ubuntu VPS hosts, prefer Google's `.deb` package over snap Chromium.
Snap Chromium can install successfully but fail later in headless screenshot
captures.

```sh
curl -fsSLo /tmp/google-chrome-stable_current_amd64.deb \
  https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt-get install -y /tmp/google-chrome-stable_current_amd64.deb
google-chrome --version
```

Preview capture preflights the target URL, rejects public internet hosts, and
is intended for services reachable from the Bureau host, such as
`http://127.0.0.1:3000`.

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
access, set the public URL, save, and restart the Bureau service
(`systemctl --user restart bureau` for the user-service setup above, or
`sudo systemctl restart bureau` for a root-managed system service).

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
