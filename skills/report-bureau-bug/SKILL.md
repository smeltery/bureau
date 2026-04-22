---
name: report-bureau-bug
description: File a bug report against the bureau repo on GitHub. Gathers system info, shows a full draft for user approval before filing.
---

Help the user file a bug report against the bureau GitHub repo (https://github.com/dotbrains/bureau).

1. Ask the user to describe the bug.
2. Gather system info: bureau version (find the bureau install directory by checking where this skill file lives — it's under `skills/` in the bureau repo — then run `git rev-parse --short HEAD` there), OS (`uname -a`), and the user's current room and desk (from ~/.bureau/agents-summary.json — match your own agent ID, do NOT include the agent name).
3. Draft a GitHub issue with the user's description and a "System info" section at the bottom.
4. Show the full draft to the user. Flag any potentially sensitive information (file paths, system details, project names, etc.) so the user can remove it. Do NOT file until they explicitly approve. Let them edit or remove anything.
5. Once approved, file using `gh issue create --repo dotbrains/bureau`.
