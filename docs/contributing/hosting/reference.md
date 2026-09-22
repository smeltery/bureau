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

