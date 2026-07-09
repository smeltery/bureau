# Development

## Toolchain (Flox)

The project pins its toolchain with a [Flox](https://flox.dev) environment at
`.flox/env/manifest.toml` — Bun (the runtime, bundler, package manager, and
test runner) plus the native-build deps `bun install` needs to compile
`node-pty` (Python, make, and a C/C++ compiler on Linux). The version is locked
in `.flox/env/manifest.lock`, so local and CI run byte-identical tooling.

```sh
flox activate                   # enter the env; first run installs deps via the hook
flox activate -- bun run dev    # or run a single command through the env
flox activate --start-services  # run the `bureau` service (= bun run dev)
```

Bump Bun by editing `bun.version` in the manifest and re-locking with
`flox edit -f .flox/env/manifest.toml`; commit the updated `manifest.lock`.

Flox is the supported path but not required — any matching Bun works with the
plain `bun install` / `bun run dev` flow.

## Quality gate

Every PR runs one CI job (`.github/workflows/ci.yml`) that activates the Flox
environment once, installs dependencies once, then runs the same root `ci`
script developers can run locally:

| Script                 | What it checks                                      |
| ---------------------- | --------------------------------------------------- |
| `bun run typecheck`    | `tsc --noEmit` across server / shared / ui / api    |
| `bun run lint`         | `oxlint` on server / shared / ui                    |
| `bun run format:check` | `prettier --check` on server / shared / ui          |
| `bun run test`         | `bun test`                                          |
| `bun run build:ui`     | Production UI bundle plus static asset copy         |
| `bun run build:server` | Server bundle/import check with Bun's server target |

All checks in the `ci` job must pass before a PR can merge.

Run the full CI gate locally before pushing:

```sh
bun run ci
```

For a faster pre-push loop that skips the build steps, run:

```sh
bun run check
```

That script chains `typecheck → lint → format:check → test`.

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

The CI workflow is the gate, but GitHub only _enforces_ it once branch
protection requires the `ci` check. To enable on `master`:

```sh
# Replace OWNER/REPO and run from a checkout with `gh` authenticated.
gh api -X PUT repos/dotbrains/bureau/branches/master/protection \
  -F required_status_checks.strict=true \
  -F 'required_status_checks.contexts[]=ci' \
  -F enforce_admins=false \
  -F required_pull_request_reviews.required_approving_review_count=0 \
  -F restrictions=
```

Or via the UI: **Settings → Branches → Add branch protection rule** for
`master`, tick _Require status checks to pass before merging_, and add the
`ci` job.

After the rule exists, GitHub disables the merge button on any PR with a
failing or pending check.
