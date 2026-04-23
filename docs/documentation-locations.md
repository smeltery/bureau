# Documentation Locations

An index of every place that describes Bureau features to users. When a new feature lands, check each of these to decide whether it needs an update. They drift apart easily — this doc exists so none get forgotten.

## 1. GitHub README

- **File:** `README.md`
- **Audience:** Developers landing on the GitHub repo.
- **Structure:**
  - Badges and tagline — quick at-a-glance info.
  - `## Quick Start` — install & first-run instructions.
  - `## At a Glance` — runtime, auth, deploy info in table form.
  - `## Documentation` — links to architecture article, docs index, and CLAUDE.md.
  - `## Features` — concise feature list.
- **Update when:** any user-visible feature is added, removed, or meaningfully changed.

## 2. Architecture Article

- **File:** `articles/punching-in-building-an-office-for-ai-agents.md`
- **Audience:** Developers wanting to understand how Bureau works under the hood.
- **Structure:** SDK internals, agent lifecycle, WebSocket layer, frontend, QoL features.
- **Update when:** architecture-level changes land (SDK upgrades, lifecycle changes, new subsystems).

## 3. Landing page

- **File:** `website/app/page.tsx` (with section components in `website/src/components/sections/`)
- **Audience:** Visitors to the project site.
- **Structure:** Distill-style marketing sections adapted for Bureau (hero, features, workflow examples, quick start, architecture links).
- **Update when:** headline features change. Keep the list short — depth lives in the README and articles.
- **Deploy note:** Next.js app in `website/`, served via Vercel.

## 4. Site chatbot system prompt

- **File:** `api/chat.ts` — `SYSTEM_PROMPT` constant (around line 25).
- **Audience:** Indirect. Feeds the chatbot that answers visitor questions.
- **Structure:** voice/tone rules, "What is Bureau?", getting started, self-hosted guide, and a feature list section.
- **Update when:** any feature changes. The prompt has an explicit "never make up features" guideline, so stale content here makes the bot lie by omission.
- **Deploy note:** Vercel Edge function, redeployed with the site.

## 5. `/help` slash command

- **File:** `server/agents/conversation/slash-commands.ts` — the `help` handler in the `commandHandlers` record.
- **Audience:** Agents/users inside Bureau who type `/help` in a conversation.
- **Content:** agent info, usage tips, and a list of available commands/skills with short descriptions.
- **Related:** `server/agents/commands.ts` holds the command registry with a `description` field on every bundled command — keep those in sync.
- **Update when:** a new slash command or skill is added, or existing command behavior changes.

## 6. Documentation Index

- **File:** `docs/INDEX.md`
- **Audience:** Anyone navigating the docs/ directory.
- **Structure:** categorized tables linking to all design docs, investigations, and plans. Includes mermaid architecture diagram.
- **Update when:** a new doc is added to `docs/` or the doc structure changes.

## Secondary / internal references

These aren't user-facing docs, but they do describe features and can fall out of date:

- `CLAUDE.md` — developer/agent-facing overview of the codebase. Update when architecture or conventions change.
- `docs/` — design documents for individual features. See `docs/INDEX.md` for navigation.
  - `docs/features/` — feature design docs (conversation branching, multi-office, task system, etc.)
  - `docs/investigations/` — bug investigations and SDK research
  - `docs/planning/` — design specs and implementation plans
- `server/agents/commands.ts` — per-command `description` fields surface in the slash-command autocomplete UI.
- `server/agents/session/system-prompt.ts` `buildSystemPrompt()` — the system prompt injected into every spawned agent. Update when the agent's role or capabilities change.

## Quick checklist when adding a user-visible feature

1. `README.md` — Feature list and/or documentation links.
2. `articles/punching-in-building-an-office-for-ai-agents.md` — if it changes architecture.
3. `docs/INDEX.md` — if you add a new doc.
4. `website/app/page.tsx` and `website/src/components/sections/*` — only if it belongs on the headline list.
5. `api/chat.ts` `SYSTEM_PROMPT` — the feature-list section and any relevant guideline.
6. `server/agents/conversation/slash-commands.ts` `/help` handler and/or `server/agents/commands.ts` — only if it adds a command or changes tips.
