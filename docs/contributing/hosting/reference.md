# Hosting Reference

This reference collects settings shared by the hosting guides.

## External Access

Claim the first owner locally before enabling external access. Before an owner
exists, Bureau binds to `127.0.0.1` only. After ownership exists, open
`User Settings -> Access`, enable external access, set the public URL, save,
and restart Bureau.

## Provider Connections

Connect Claude, Codex, or OpenCode from `User Settings -> Connections`.
Provider CLI state and API keys live on the host. Every authenticated member
should be trusted with shell-equivalent access to that host.

## Invites

Owners can create one-time invite links from `User Settings -> Access`.
Members can create self-invites for their own additional devices.

## Reverse Proxies

Bureau trusts a local process (loopback with no forwarding header) on the
agent HTTP API. A request relayed by a same-host proxy such as Caddy,
`tailscale serve` or Funnel carries `X-Forwarded-For`, so it is treated as an
outside client and needs a session, whatever the proxy setting.

Agent, cron-run and app tokens work only from this machine. One presented
from off-box (directly or through a proxy) is refused with `401`, and the
office logs one line naming the holder. Personal API tokens are unaffected.

Set `BUREAU_TRUSTED_PROXY` so rate limits count each real client instead of
the proxy:

| Value | Use when | Rate-limit key |
| --- | --- | --- |
| `none` (default) | clients connect straight to Bureau's port | TCP peer |
| `same-host` | Caddy, `tailscale serve` or Funnel on the same machine | rightmost `X-Forwarded-For` on loopback requests |
| `load-balancer` | Render, Kubernetes, or another off-box balancer | rightmost `X-Forwarded-For` on off-box requests |

## Backups

Bureau writes state under `~/.bureau` or `BUREAU_HOME`. Daily backup tarballs
are written to `~/bureau-backups` by default, with the last seven retained.
For manual restore, stop Bureau, move the current state aside, extract the
chosen backup, and restart Bureau.

## Health Checks

Run this after dependency changes, host moves, or preview/terminal failures:

```sh
bun run doctor
```

`WARN` lines identify optional or degraded capabilities. `FAIL` lines should
be fixed before considering the host healthy.

