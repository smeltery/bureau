# Development

## Quality gate

Every PR runs a CI workflow with five jobs (`.github/workflows/ci.yml`):

| Job          | Command                | What it checks                                |
| ------------ | ---------------------- | --------------------------------------------- |
| `typecheck`  | `bun run typecheck`    | `tsc --noEmit` across server / shared / ui    |
| `oxlint`     | `bun run lint`         | `oxlint` on server / shared / ui              |
| `format`     | `bun run format:check` | `prettier --check` on server / shared / ui    |
| `unit tests` | `bun run test`         | `bun test` (cronjob scheduler + shared types) |
| `build`      | `bun build …`          | UI + server bundle, catches import errors     |

All five must pass before a PR can merge.

Run them all locally before pushing:

```sh
bun run check
```

That script chains `typecheck → lint → format:check → test`. The CI also runs
the `build` job on top.

## Tooling notes

- **Lint:** `oxlint`. Config: `.oxlintrc.json`. Some rules (`preserve-caught-error`,
  `no-await-in-loop`, etc.) are intentionally disabled to match existing
  patterns in the codebase.
- **Format:** `prettier`. Config: `.prettierrc.json`. Ignore patterns:
  `.prettierignore`. We chose prettier over `oxfmt` (a faster but pre-1.0
  formatter) because oxfmt's output diverged across platforms in CI; prettier
  is deterministic and battle-tested.
- **Tests:** `bun test`. Test files live next to their subject in a
  `__tests__/` folder.

## Fixing common failures

- **Format check fails.** Run `bun run format` to fix in place, then commit.
- **Lint fails.** Run `bun run lint --fix` to auto-fix what's safe.
- **Tests fail.** Run `bun test path/to/test.ts` to focus on a single file.
- **Typecheck fails.** Run `bun run typecheck` and follow the diagnostics.

## Adding tests

Tests live next to their subject in a `__tests__/` folder, e.g.
`server/cronjobs/__tests__/schedule.test.ts`. Bun's built-in test runner
discovers `*.test.ts` files automatically — no config required.

When testing server-side modules, prefer importing from a side-effect-free
module (like `server/cronjobs/schedule.ts`) rather than from a barrel that
loads the SDK or reads the filesystem on import.

## Branch protection (one-time setup)

The CI workflow is the gate, but GitHub only *enforces* it once branch
protection requires the checks. To enable on `master`:

```sh
# Replace OWNER/REPO and run from a checkout with `gh` authenticated.
gh api -X PUT repos/dotbrains/bureau/branches/master/protection \
  -F required_status_checks.strict=true \
  -F 'required_status_checks.contexts[]=typecheck' \
  -F 'required_status_checks.contexts[]=oxlint' \
  -F 'required_status_checks.contexts[]=format' \
  -F 'required_status_checks.contexts[]=unit tests' \
  -F 'required_status_checks.contexts[]=build' \
  -F enforce_admins=false \
  -F required_pull_request_reviews.required_approving_review_count=0 \
  -F restrictions=
```

Or via the UI: **Settings → Branches → Add branch protection rule** for
`master`, tick *Require status checks to pass before merging*, and add the
five jobs above (`typecheck`, `oxlint`, `format`, `unit tests`, `build`).

After the rule exists, GitHub disables the merge button on any PR with a
failing or pending check.
