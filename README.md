<div align="center">

# Bureau 🏢

**Your agent office.** *Cute in a useful way.*

![demo](demo/demo-office.gif)

**Free · no cloud · no account · works with your Claude subscription**

[![CI](https://github.com/dotbrains/bureau/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/dotbrains/bureau/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/License-PolyForm%20Shield%201.0.0-blue.svg)](https://polyformproject.org/licenses/shield/1.0.0/)

![Bun](https://img.shields.io/badge/-Bun-000000?style=flat-square&logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/-React-61DAFB?style=flat-square&logo=react&logoColor=black)
![Anthropic](https://img.shields.io/badge/-Anthropic-191919?style=flat-square&logo=anthropic&logoColor=white)
![macOS](https://img.shields.io/badge/-macOS-000000?style=flat-square&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/-Linux-FCC624?style=flat-square&logo=linux&logoColor=black)
[![CI on Blacksmith](https://img.shields.io/badge/CI-Blacksmith-1F2937?style=flat-square&logoColor=white)](https://blacksmith.sh)

</div>

---

Friction going from 1 Claude Code to 4+? Bureau is a browser-based office where each AI agent sits at a desk. See who's working, who's sleeping, and who needs you — at a glance.

## Quick Start

The project ships a [Flox](https://flox.dev) environment that pins Bun and the
native-build toolchain, so local and CI run an identical setup:

```sh
git clone https://github.com/dotbrains/bureau.git
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

| | |
|---|---|
| **Runtime** | Single Bun process — no bundler, no database |
| **Auth** | Your Claude subscription (CLI login) — no API key |
| **Frontend** | React + SVG, served from the same process |
| **Sync** | WebSocket — every device stays in lockstep |
| **Persistence** | File system (`~/.bureau/` or `BUREAU_HOME`) — survives crashes |
| **Deploy** | Local or headless server + Tailscale |

## Documentation

| | |
|---|---|
| [**Design & Architecture**](articles/punching-in-building-an-office-for-ai-agents.md) | Deep dive: how Bureau works under the hood |
| [**Documentation**](docs/README.md) | Navigate all design docs, investigations, and plans |
| [**CLAUDE.md**](CLAUDE.md) | Developer & agent guide to the codebase |

## Features

### 🏢 Office & orchestration

- **Visual office metaphor** — isometric desks, animated characters, status lights
- **Multi-agent orchestration** — spawn, manage, and monitor concurrent Claude Code sessions
- **Real-time sync** — WebSocket keeps every connected device in lockstep
- **Live presence** — other users and devices appear in the office with customizable ghosts, so shared rooms show who is around
- **Per-agent message queue** — typing while an agent is busy queues messages as chips above the input; they flush automatically when the agent idles, and you can cancel any of them before they send
- **Session-swap indicator** — chat shows a brief "Restarting session..." hint during `/resume`, `/model`, or fork-from-edit so the drain → install gap isn't silent

### 🛠️ Workspace tools

- **File editor side panel** — built-in CodeMirror editor with tabs, syntax highlighting, dirty-buffer tracking, and external-change detection; agents can offer `[Open in editor]` cards via `POST /api/agents/:id/edit-file`
- **Embedded terminal** — per-agent shell access with a mobile full-screen overlay (Tab / Esc / Ctrl+C / Paste soft-keys, IME-friendly textarea); agents can offer `[Copy to terminal]` cards via `POST /api/agents/:id/terminal-command` that prefill a command at the prompt without executing
- **Resizable side panels** — drag the splitter to size the terminal or editor; widths persist
- **Rich diff viewer** — `/bureau-diff` (or `POST /api/agents/:id/diff`) renders uncommitted changes as a per-file card with status badges, +/- counts, and unified/split toggle
- **File attachments** — images, PDFs, arbitrary files; agents can surface their own files via `POST /api/agents/:id/read-file` (images render inline, others as clickable chips)
- **Browser preview cards** — agents can screenshot local or private development URLs via `POST /api/agents/:id/preview-url` and show the result inline
- **Mermaid diagrams in chat** — agent messages with ```` ```mermaid ```` fenced blocks render as inline SVG (lazy-loaded, theme-aware). Parse failures show the offending source in-place instead of a silent blank.

### 🤝 Collaboration & tasks

- **Shared task board** — humans and agents create, assign, and close tasks (with a Backlog status for deferred work); search by id, title, or description
- **Inter-agent discovery & messaging** — agents can read each other's conversations and send messages directly via `POST /api/agents/:id/messages`; the receiver sees them in the same queue as human-typed input, prefixed so they can tell agent senders from human bosses
- **Conversation branching** — fork any past message, preserve the original
- **Slash commands** — `/bureau-peer-review`, `/bureau-pair-programming`, `/bureau-second-opinion`, `/bureau-soft-handoff`, `/bureau-subagent-review`, `/bureau-all-hands`, `/bureau-diff`, `/bureau-edit`, `/bureau-system-prompt`, `/bureau-cronjob-system-prompt`, `/usage`, `/resume`, `/model`, `/effort`, and more

### ⚙️ Automation & extensibility

- **Cron jobs** — scheduled SDK sessions (daily/weekly/interval) with browsable per-run transcripts; resume or edit-to-fork any past run
- **Plugin system** — extend bureau without forking. TypeScript modules register `beforeTurn` / `afterTurn` hooks that run around every agent turn (e.g. inject memory context before, write extracted facts after). Enable via `enabledPlugins` in `~/.bureau/office-config.json`; see [Plugin system](docs/features/plugin-system.md). Reference plugin: [bureau-dossier](https://github.com/dotbrains/bureau-dossier) gives agents long-term memory across sessions.
- **Plugin manager** — browse, install, enable/disable, update, and remove Claude Code plugins (and their marketplaces) from the Plugins panel in the office toolbar, instead of dropping to the CLI. Agents inherit installed plugins on their next session. See [Plugin management](docs/features/plugin-management-design.md)
- **Safety hooks** — blocks `rm -rf`, `git reset --hard`, and other footguns
- **Daily backups** — automatic tarball of Bureau state to `~/bureau-backups/` (last 7 retained)

### 🔐 Access & platform

- **Self-hosted with invite-link auth** — the first visitor on the host machine claims ownership at a localhost-only form; owners then mint one-time invite URLs from the Access pane to add devices or other people. Sessions are cookie-gated end-to-end (HTTP + WebSocket), with per-message revocation, role-scoped per-user views, and a `bun run server/index.ts owner-login --name <you>` recovery CLI over a Unix-domain admin socket. See [Access & invites](docs/features/access-and-invites.md)
- **Mobile & PWA** — touch-optimized UI, installable on any device
- **Room-scoped notifications** — opt into sound and desktop alerts for the rooms you care about when agents finish in the background
- **Voice I/O** — speech-to-text prompts, text-to-speech responses
- **6 color themes** — Dark, Light, Nord, Dracula, Solarized Dark, Solarized Light; pick from the theme picker in the header. First load follows your OS `prefers-color-scheme` (and live-updates if you flip it system-wide) until you make an explicit choice. Per-mode last-pick is remembered, so a quick moon/sun toggle swaps between your two favorites instead of resetting to canonical Dark/Light

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
