# Files, Diffs, Previews, And Terminal Cards

Use these only to surface something useful to the boss.

- `POST /api/agents/<your-id>/read-file` with `{"path":"plot.png"}` shows an image inline or a file chip.
- `POST /api/agents/<your-id>/diff` with `{}` shows the current git diff. Add `dir` for another worktree or `commit` for one ref/range.
- `POST /api/agents/<your-id>/preview-url` captures a local/private development URL. Optional `viewport` is `{width,height}` and optional `wait` is milliseconds.
- `POST /api/agents/<your-id>/edit-file` opens a file in the boss's editor side panel.
- `POST /api/agents/<your-id>/terminal-command` offers a single shell command in the boss's terminal panel without executing it.

All calls use `Authorization: Bearer $BUREAU_AGENT_TOKEN`.
