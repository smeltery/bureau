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

App PRs run `.github/workflows/ci.yml`, which activates the Flox environment,
installs dependencies once, then runs the same root `ci` script developers can
run locally:

| Script                 | What it checks                                      |
| ---------------------- | --------------------------------------------------- |
| `bun run typecheck`    | `tsc --noEmit` across server / shared / ui / api    |
| `bun run lint`         | `oxlint` on server / shared / ui                    |
| `bun run format:check` | `prettier --check` on server / shared / ui          |
| `bun run test`         | `bun test`                                          |
| `bun run build:ui`     | Production UI bundle plus static asset copy         |
| `bun run build:server` | Server bundle/import check with Bun's server target |

All checks in the `app-ci` job must pass before an app PR can merge. Website
changes run `.github/workflows/website-ci.yml`, which uses the website's npm
lockfile and `npm run ci` from `website/`.

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
- **Tests never touch your real office.** `bunfig.toml` preloads
  `scripts/test-preload.ts`, which points `BUREAU_HOME` at a throwaway temp
  directory before the first test module loads — necessary because
  `server/persistence/paths.ts` resolves `BUREAU_DIR` once at module load, so a
  test body cannot redirect it afterwards. Set `BUREAU_HOME` yourself to
  override. It is ONE directory for the whole run, though: files that write
  persisted state still clear and re-persist in `afterEach`, because a later
  file whose imports boot the server would otherwise restore another file's
  fixtures into the shared agents map.

## Fixing common failures

- **Format check fails.** Run `bun run format` to fix in place, then commit.
- **Lint fails.** Run `bun run lint --fix` to auto-fix what's safe.
- **Tests fail.** Run `bun test path/to/test.ts` to focus on a single file. A
  test that passes alone but fails in the suite is usually shared persisted
  state: check whether the file leaves an agents map behind for a later file to
  restore.
- **Typecheck fails.** Run `bun run typecheck` and follow the diagnostics.

## Adding tests

Tests live next to their subject in a `__tests__/` folder, e.g.
`server/cronjobs/__tests__/schedule.test.ts`. Bun's built-in test runner
discovers `*.test.ts` files automatically — no config required.

When testing server-side modules, prefer importing from a side-effect-free
module (like `server/cronjobs/schedule.ts`) rather than from a barrel that
loads the SDK or reads the filesystem on import.

## Branch protection (one-time setup)

The CI workflows are the gates, but GitHub only _enforces_ them once branch
protection requires their status checks. Because these workflows use path
filters, do not require a check globally unless it runs for every protected PR;
otherwise GitHub can leave the skipped workflow pending. To require the app gate
on `master`:

```sh
# Replace OWNER/REPO and run from a checkout with `gh` authenticated.
gh api -X PUT repos/smeltery/bureau/branches/master/protection \
  -F required_status_checks.strict=true \
  -F 'required_status_checks.contexts[]=app-ci' \
  -F enforce_admins=false \
  -F required_pull_request_reviews.required_approving_review_count=0 \
  -F restrictions=
```

Or via the UI: **Settings → Branches → Add branch protection rule** for
`master`, tick _Require status checks to pass before merging_, and add the
`app-ci` job.

After the rule exists, GitHub disables the merge button on any PR with a
failing or pending check.
