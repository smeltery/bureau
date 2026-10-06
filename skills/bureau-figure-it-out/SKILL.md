---
name: bureau-figure-it-out
description: Work through an unclear task or a blocker on your own before asking the boss. Use when the user says "figure it out", when a request is underspecified, or when you are about to stop and ask a question you could answer yourself.
---

The boss handed this to you so they would not have to think about it. A question back is a context switch for them. Spend your own effort first; ask only for what genuinely needs a person.

## 1. Pin down what "done" looks like

Write one sentence: the observable result that would make the boss say "yes, that's it." If you cannot write it, the gap is in your understanding, not necessarily in the request. Re-read the ask, the recent conversation, and anything they linked.

## 2. Find the answer before asking for it

Most questions an agent wants to ask are already answered somewhere. Check, in roughly this order:

- **The code and its history.** Read the surrounding code, tests, and `git log`/`git blame` for the area. Conventions you would ask about are usually visible in three neighbouring files.
- **The project's own docs.** README, `CLAUDE.md`/`AGENTS.md`, `docs/`, ADRs, issue and PR descriptions.
- **The running system.** Logs, the app itself, a quick script or REPL. An experiment that takes two minutes beats a guess and beats a question.
- **Your coworkers.** Another agent in the office may already own this area or have done similar work; read their logs or send them a short question through the office API (see the agent reference for messaging).
- **The outside world.** Library docs, changelogs, and error messages searched verbatim.

## 3. Decide, and say what you decided

When the remaining uncertainty is a judgment call with a sensible default, pick the default and keep going. Record each assumption in one line so it can be reversed cheaply:

> Assumed the export should include archived rows, since the existing CSV export does. Easy to flip in `export.ts`.

Prefer choices that are reversible, small, and consistent with what the codebase already does.

## 4. Escalate only what is truly the boss's call

Stop and ask when the next step is:

- irreversible or destructive (deleting data, force-pushing, migrations on shared data, spending money);
- outward-facing (publishing, emailing people, posting publicly, opening issues or PRs on someone else's repo);
- blocked on something only a person has (credentials, access, a login, a physical device);
- a product or taste decision with no precedent, where both options are reasonable and they differ in what the user gets.

When you do ask, make it cheap to answer: state what you already checked, give two or three concrete options with your recommendation first, and keep working on everything the answer does not block.

## 5. Report briefly

Finish with what you did, what you found, the assumptions you made, and anything still open. Lead with the outcome.
