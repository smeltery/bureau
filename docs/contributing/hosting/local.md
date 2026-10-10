# Run Bureau On This Computer

Use this path when you only need Bureau on the machine in front of you.

## Install

Use Bun 1.4.2 and Node 24 (needed for the terminal sidecar), or run the commands
inside `flox activate` to use the repository's locked toolchain.

```sh
git clone https://github.com/smeltery/bureau.git
cd bureau
bun install
bun run dev
```

Open `http://localhost:4000`, choose an owner name, and enter the office.

## Notes

- Bureau binds to `127.0.0.1` before the first owner exists.
- The local server is enough for development and single-device use.
- To reach Bureau from another device, use the private Tailscale, Funnel,
  domain, VPS, or Render guide instead.

