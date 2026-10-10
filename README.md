# Bureau 🏢

**Your agent office.** _Cute in a useful way._

[![bureau — Four agents. One office. One glance.](website/public/og.png)](https://bureau.smeltery.io)

**Self-hosted · source-available · works with your Claude subscription**

[![CI](https://github.com/smeltery/bureau/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/smeltery/bureau/actions/workflows/ci.yml)
[![License: BSL 1.1 / MIT contributions](https://img.shields.io/badge/License-BSL%201.1%20%2F%20MIT%20contributions-blue.svg)](LICENSING.md)

![Bun](https://img.shields.io/badge/-Bun-000000?style=flat-square&logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/-React-61DAFB?style=flat-square&logo=react&logoColor=black)
![Anthropic](https://img.shields.io/badge/-Anthropic-191919?style=flat-square&logo=anthropic&logoColor=white)
![macOS](https://img.shields.io/badge/-macOS-000000?style=flat-square&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/-Linux-FCC624?style=flat-square&logo=linux&logoColor=black)
[![CI on Blacksmith](https://img.shields.io/badge/CI-Blacksmith-1F2937?style=flat-square&logoColor=white)](https://blacksmith.sh)

---

Friction going from 1 Claude Code to 4+? Bureau is a browser-based office where each AI agent sits at a desk. See who's working, who's sleeping, and who needs you — at a glance.

![demo](demo/demo-office.gif)

## Quick Start

The project ships a [Flox](https://flox.dev) environment that pins Bun and the
native-build toolchain, so local and CI run an identical setup:

```sh
git clone https://github.com/smeltery/bureau.git
cd bureau
flox activate              # installs the pinned toolchain + deps on first run
bun run dev                # or: flox activate --start-services
```

No Flox? Bring your own Bun:

```sh
bun install
bun run dev
```

Then open **http://localhost:4000** and click an empty desk.

## At a Glance

|                 |                                                                |
| --------------- | -------------------------------------------------------------- |
| **Runtime**     | Single Bun process — no bundler, no database                   |
| **Auth**        | Your Claude subscription (CLI login) — no API key              |
| **Frontend**    | React + SVG, served from the same process                      |
| **Sync**        | WebSocket — every device stays in lockstep                     |
| **Persistence** | File system (`~/.bureau/` or `BUREAU_HOME`) — survives crashes |
| **Deploy**      | Local or headless server + Tailscale                           |

Save recurring or on-demand jobs in **Schedules**, and keep resolved incidents in
your **Pager** history. Manage agent prompts in the [Skills library](docs/features/skills-library.md). OpenCode uses [durable manager/room profiles](docs/features/opencode-environments.md) so credential changes preserve conversation history. See the [full feature list](docs/features/full-feature-list.md).

## Documentation

|                                                                                       |                                                     |
| ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [**Design & Architecture**](articles/punching-in-building-an-office-for-ai-agents.md) | Deep dive: how Bureau works under the hood          |
| [**Documentation**](docs/README.md)                                                   | Navigate all design docs, investigations, and plans |
| [**CLAUDE.md**](CLAUDE.md)                                                            | Developer & agent guide to the codebase             |

## Project Structure

```
bureau/
├── server/          # Bun HTTP + WebSocket server, agent lifecycle, SDK
├── ui/              # React frontend (isometric office, conversation view)
├── demo/            # Standalone demo app (build + static assets)
├── shared/          # TypeScript types shared between server and UI
├── api/             # HTTP API endpoints (chat, uploads)
├── website/         # Marketing website (Vite + React, Vercel)
├── skills/          # Bureau-bundled Claude Code skills
├── articles/        # Blog-style articles
├── docs/            # Design docs, investigations, plans
└── scripts/         # Build and dev scripts
```

Signed [inbound webhooks](docs/features/inbound-webhooks.md) can queue agent work or
start room-scoped schedules. The [Chrome extension](docs/features/browser-sharing.md)
shares explicitly offered tabs with selected agents, including bounded file uploads. Apps supports thumbnails and
reversible archive, and room tabs support personal ordering and tucked rooms.

## License

Bureau is a source-available, modified distribution based on
[Isomux](https://github.com/nmamano/isomux), created by Nil Mamano, and maintained
independently by smeltery. No upstream endorsement is implied.

The combined work is subject to the applicable upstream [BSL 1.1](LICENSE)
terms. Personal production use and production use for organizations with at
most 10 people are permitted by the upstream Additional Use Grant; other
production use requires an upstream commercial license. Redistribution is
permitted subject to the license terms.

Historical MIT material retains its [original notice](NOTICE). Original
contributions owned by smeltery are [MIT-licensed](LICENSES/smeltery-MIT.txt);
this does not make the entire project MIT-licensed. See
[LICENSING.md](LICENSING.md) for scope, redistribution requirements, and the
provenance review.
