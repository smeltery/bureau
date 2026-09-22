# Run A Private Office With Tailscale

Use this path for a Linux computer or server you keep online, where every
person and device can join your tailnet.

## Install Bureau

```sh
sudo apt-get update
sudo apt-get install -y git curl ca-certificates build-essential python3 make g++ nodejs
curl -fsSL https://bun.sh/install | bash
exec "$SHELL" -l
git clone https://github.com/smeltery/bureau.git ~/bureau
cd ~/bureau
bun install
bun run build:ui
bun run doctor
```

Open `http://localhost:4000` on the host and create the first owner before
exposing the service.

## Keep It Running

```sh
mkdir -p ~/.config/systemd/user
cp docs/contributing/bureau.service.example ~/.config/systemd/user/bureau.service
$EDITOR ~/.config/systemd/user/bureau.service
systemctl --user daemon-reload
systemctl --user enable --now bureau
sudo loginctl enable-linger "$USER"
systemctl --user status bureau
```

Restarting the service interrupts active agents, so wait for agents to go idle
before planned restarts.

## Give The Office A Private HTTPS Address

Install Tailscale on the host and on each client device. Then inspect any
existing mappings:

```sh
tailscale serve status
tailscale funnel status
```

If port 443 already serves another application, resolve that mapping before
replacing it. A port cannot be both private Serve and public Funnel.

```sh
sudo tailscale set --operator=$USER
tailscale serve --bg http://localhost:4000
```

Copy the HTTPS address that Tailscale prints, such as
`https://office.your-tailnet.ts.net`. In Bureau, open
`User Settings -> Access`, enable external access, set that URL, save, and
restart the service:

```sh
systemctl --user restart bureau
```

Test from a phone or laptop while connected to Tailscale. Invite other people
to the tailnet before they open a Bureau invite link.

## Apps

Tailscale names do not provide wildcard app hostnames. Agent-built apps keep
using their own host-and-port links, reachable only where the host and firewall
allow those ports.

