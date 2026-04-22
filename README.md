# Bureau

![demo](demo/demo-office.gif)

Your agent office. *Cute in a useful way.*

[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/License-PolyForm%20Shield%201.0.0-blue.svg)](https://polyformproject.org/licenses/shield/1.0.0/)

![Bun](https://img.shields.io/badge/-Bun-000000?style=flat-square&logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/-React-61DAFB?style=flat-square&logo=react&logoColor=black)
![Anthropic](https://img.shields.io/badge/-Anthropic-191919?style=flat-square&logo=anthropic&logoColor=white)
![macOS](https://img.shields.io/badge/-macOS-000000?style=flat-square&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/-Linux-FCC624?style=flat-square&logo=linux&logoColor=black)

---

Friction going from 1 Claude Code to 4+? Bureau is a browser-based office where each AI agent sits at a desk. See who's working, who's sleeping, and who needs you — at a glance.

**Free · no cloud · no account · works with your Claude subscription**

## Quick Start

```sh
git clone https://github.com/dotbrains/bureau.git
cd bureau
bun install
bun run dev
```

Then open **http://localhost:4000** and click an empty desk.

## At a Glance

| | |
|---|---|
| **Runtime** | Single Bun process — no bundler, no database |
| **Auth** | Your Claude subscription (CLI login) — no API key |
| **Frontend** | React + SVG, served from the same process |
| **Sync** | WebSocket — every device stays in lockstep |
| **Persistence** | File system (`~/.bureau/`) — survives crashes |
| **Deploy** | Local or headless server + Tailscale |

## Documentation

| | |
|---|---|
| [**Design & Architecture**](articles/punching-in-building-an-office-for-ai-agents.md) | Deep dive: how Bureau works under the hood |
| [**Documentation**](docs/README.md) | Navigate all design docs, investigations, and plans |
| [**CLAUDE.md**](CLAUDE.md) | Developer & agent guide to the codebase |

## Features

- **Visual office metaphor** — isometric desks, animated characters, status lights
- **Multi-agent orchestration** — spawn, manage, and monitor concurrent Claude Code sessions
- **Real-time sync** — WebSocket keeps every connected device in lockstep
- **Mobile & PWA** — touch-optimized UI, installable on any device
- **Embedded terminal** — per-agent shell access
- **Voice I/O** — speech-to-text prompts, text-to-speech responses
- **Safety hooks** — blocks `rm -rf`, `git reset --hard`, and other footguns
- **Conversation branching** — fork any past message, preserve the original
- **Shared task board** — humans and agents create, assign, and close tasks
- **Inter-agent discovery** — agents can read each other's conversations
- **Slash commands** — `/bureau-peer-review`, `/bureau-all-hands`, and more
- **File attachments** — images, PDFs, arbitrary files

For the full feature list, see the [design & architecture article](articles/punching-in-building-an-office-for-ai-agents.md).

## Project Structure

```
bureau/
├── server/          # Bun HTTP + WebSocket server, agent lifecycle, SDK
├── ui/              # React frontend (isometric office, conversation view)
├── demo/            # Standalone demo app (build + static assets)
├── shared/          # TypeScript types shared between server and UI
├── api/             # HTTP API endpoints (chat, uploads)
├── website/         # Marketing website (Next.js, Vercel)
├── skills/          # Bureau-bundled Claude Code skills
├── articles/        # Blog-style articles
├── docs/            # Design docs, investigations, plans
└── scripts/         # Build and dev scripts
```

## License

[PolyForm Shield License 1.0.0](LICENSE)
