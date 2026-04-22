# Demo

![demo](./demo-office.gif)

Standalone demo app for Bureau, served from the `/demo` route.

## Run locally
From repo root:

```sh
bun install
bun run demo
```

`bun run demo` builds demo assets and starts the server. By default it uses port `4001` (unless `PORT` is already set).

Open:
- `http://localhost:4001/demo`
- `http://localhost:4001/demo?embed` (embed mode)

## Build only
From repo root:

```sh
bun run demo:build
```

Build output is written to `demo/dist/`:
- `index.html`
- `demo-entry.js`
- `xterm.css`

## Files
- `demo/demo-entry.tsx` — demo entrypoint
- `demo/demo-server.ts` — in-browser demo backend shim/state seeding
- `demo/index.html` — HTML shell for the demo app

## Notes
- The demo reuses UI and shared modules via imports from `ui/` and `shared/`.
- `server/index.ts` serves `/demo/*` from `demo/dist`.
