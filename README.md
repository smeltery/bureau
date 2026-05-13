# Bureau 🏢

![demo](demo/demo-office.gif)

Your agent office. *Cute in a useful way.*

[![CI](https://github.com/dotbrains/bureau/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/dotbrains/bureau/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/License-PolyForm%20Shield%201.0.0-blue.svg)](https://polyformproject.org/licenses/shield/1.0.0/)

![Bun](https://img.shields.io/badge/-Bun-000000?style=flat-square&logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/-React-61DAFB?style=flat-square&logo=react&logoColor=black)
![Anthropic](https://img.shields.io/badge/-Anthropic-191919?style=flat-square&logo=anthropic&logoColor=white)
![macOS](https://img.shields.io/badge/-macOS-000000?style=flat-square&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/-Linux-FCC624?style=flat-square&logo=linux&logoColor=black)
[![CI on Blacksmith](https://img.shields.io/badge/CI-Blacksmith-1F2937?style=flat-square&logoColor=white)](https://blacksmith.sh)

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
- **Cron jobs** — scheduled SDK sessions (daily/weekly/interval) with browsable per-run transcripts; resume or edit-to-fork any past run
- **Real-time sync** — WebSocket keeps every connected device in lockstep
- **Mobile & PWA** — touch-optimized UI, installable on any device
- **File editor side panel** — built-in CodeMirror editor with tabs, syntax highlighting, dirty-buffer tracking, and external-change detection; agents can offer `[Open in editor]` cards via `POST /agents/:id/edit-file`
- **Embedded terminal** — per-agent shell access with a mobile full-screen overlay (Tab / Esc / Ctrl+C / Paste soft-keys, IME-friendly textarea); agents can offer `[Copy to terminal]` cards via `POST /agents/:id/terminal-command` that prefill a command at the prompt without executing
- **Resizable side panels** — drag the splitter to size the terminal or editor; widths persist
- **Per-agent message queue** — typing while an agent is busy queues messages as chips above the input; they flush automatically when the agent idles, and you can cancel any of them before they send
- **Voice I/O** — speech-to-text prompts, text-to-speech responses
- **Safety hooks** — blocks `rm -rf`, `git reset --hard`, and other footguns
- **Conversation branching** — fork any past message, preserve the original
- **Shared task board** — humans and agents create, assign, and close tasks (with a Backlog status for deferred work); search by id, title, or description
- **Rich diff viewer** — `/bureau-diff` (or `POST /agents/:id/diff`) renders uncommitted changes as a per-file card with status badges, +/- counts, and unified/split toggle
- **Session-swap indicator** — chat shows a brief "Restarting session..." hint during `/resume`, `/model`, or fork-from-edit so the drain → install gap isn't silent
- **Daily backups** — automatic tarball of `~/.bureau/` to `~/bureau-backups/` (last 7 retained)
- **Inter-agent discovery & messaging** — agents can read each other's conversations and send messages directly via `POST /agents/:id/message`; the receiver sees them in the same queue as human-typed input, prefixed so they can tell agent senders from human bosses
- **Slash commands** — `/bureau-peer-review`, `/bureau-all-hands`, `/bureau-diff`, `/bureau-system-prompt`, `/usage`, `/resume`, `/model`, and more
- **File attachments** — images, PDFs, arbitrary files; agents can surface their own files via `POST /agents/:id/read-file` (images render inline, others as clickable chips)

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
