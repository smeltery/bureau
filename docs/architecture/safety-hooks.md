# Safety Hooks

Bureau injects `PreToolUse` hooks into every SDK session to block dangerous commands before they execute. The hook system lives under `server/agents/session/safety/`, split across focused modules:

- `index.ts` — `createSafetyHooks()` + the three hook callbacks (Bash / Read / Write+Edit)
- `bash-parser.ts` — `stripQuotedStrings`, `normalizeAbsolutePaths`
- `patterns.ts` — `DESTRUCTIVE_PATTERNS` + `SAFE_PATTERNS` (git and rm)
- `bureau-protection.ts` — `BUREAU_DIR` + `commandWritesToBureau`
- `secrets.ts` — sensitive-file detection (`.env`, keys, credentials)
- `deny-helpers.ts` — `deny` / `allow` / `denyMessage` / `denySecretRead`

## Hook Architecture

Hooks are registered via `createSafetyHooks()`, which returns a `Partial<Record<HookEvent, HookCallbackMatcher[]>>` consumed by `SDKSessionOptions.hooks`:

```typescript
export function createSafetyHooks() {
  return {
    PreToolUse: [
      { matcher: "Bash", hooks: [checkBashSafety] },
      { matcher: "Read", hooks: [checkSensitiveFileRead] },
      { matcher: "Write", hooks: [checkWriteEditSafety] },
      { matcher: "Edit", hooks: [checkWriteEditSafety] },
    ],
  };
}
```

Four hook callbacks cover three tool types:

| Hook Callback | Triggered By | Purpose |
|--------------|--------------|---------|
| `checkBashSafety` | Bash tool | Git safety, filesystem safety, secrets via shell |
| `checkSensitiveFileRead` | Read tool | Block reading sensitive files (.env, keys, etc.) |
| `checkWriteEditSafety` | Write/Edit tools | Block writes to `~/.bureau/` |

## 1. Git Safety

Blocks destructive git commands that could lose uncommitted work:

| Blocked Pattern | Reason |
|----------------|--------|
| `git checkout -- <path>` | Discards uncommitted changes |
| `git restore` (without `--staged` or `-S`) | Discards working tree changes |
| `git reset --hard` / `--merge` | Destroys uncommitted changes |
| `git clean -[a-z]*f` | Removes untracked files permanently |
| `git push --force` / `-f` | Destroys remote history |
| `git branch -D` | Force-deletes without merge check |
| `git stash drop` / `clear` | Permanently deletes stashed changes |

### Allowlist

Safe patterns that would otherwise match blocklist entries:

| Allowed Pattern | Why Safe |
|----------------|----------|
| `git checkout -b` | Creating new branch |
| `git checkout --orphan` | Creating orphan branch |
| `git restore --staged` (without `--worktree`) | Unstaging only |
| `git clean -n` / `--dry-run` | Preview only, no changes |

## 2. Filesystem Safety

Blocks `rm -rf` on dangerous paths:

| Pattern | Action |
|---------|--------|
| `rm -rf /` or `rm -rf ~` | **BLOCKED** — extremely dangerous |
| `rm -rf` (any path) | **BLOCKED** — requires human approval |
| `rm -rf /tmp/` or `/var/tmp/` | **ALLOWED** — temp directories are safe |
| `rm -rf $TMPDIR/` | **ALLOWED** — macOS temp directory |

Supports all flag orderings: `-rf`, `-fr`, separate flags (`-r -f`), and long options (`--recursive --force`).

## 3. Bureau Config Protection

Blocks all writes to `~/.bureau/` — the directory managed by the server:

### Write Detection

1. **Redirection**: `> ~/.bureau/` or `>> ~/.bureau/` — blocked.
2. **Write commands**: `cp`, `mv`, `rm`, `mkdir`, `touch`, `sed`, `python`, etc. with `~/.bureau/` as argument — blocked.
3. **Copy commands**: `cp`, `rsync`, `scp` — only the destination (last arg) is checked. Reading *from* `~/.bureau/` is allowed.

### Read-Only Commands (Always Allowed)

`cat`, `ls`, `head`, `tail`, `less`, `grep`, `rg`, `find`, `stat`, `wc`, `file`, `diff`, `bat`, `jq`, `tree`

Agents should use `GET /api/agents` with their bearer token for peer discovery and need read access to `logs/` for reading other agents' conversations.

## 4. Secrets Protection

Blocks reads of sensitive files:

### Sensitive File Patterns

| Pattern | Examples |
|---------|----------|
| Exact basenames | `.env`, `.netrc`, `.pgpass`, `credentials.json`, `service-account.json` |
| `.env.*` | `.env.local`, `.env.production`, `.env.development` |
| `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks` | TLS/SSH private keys, keystores |
| `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `id_dsa*` | SSH private keys |

### Safe Suffixes (Allowed)

`.example`, `.template`, `.sample`, `.dist` — e.g., `.env.example` is permitted.

### Shell Command Detection

Blocks file-reading commands targeting sensitive files: `cat`, `head`, `tail`, `less`, `more`, `bat`, `strings`, `xxd`, `hexdump`, `od`, `base64`.

## Command Preprocessing

Before pattern matching, commands are preprocessed:

### Quote Stripping

`stripQuotedStrings()` removes quoted content so patterns don't match commit messages, echo arguments, etc.:

- Double-quoted strings: `"don't rm -rf this"` → `""`
- Single-quoted strings: `'git checkout -- "message"'` → `'git checkout -- ""'`
- Heredocs: `<<'EOF' ... EOF` → removed entirely
- ANSI-C quoting: `$'...'` → removed

### Path Normalization

`normalizeAbsolutePaths()` strips absolute paths to bare commands:

- `/bin/rm` → `rm`
- `/usr/bin/git` → `git`
- `/usr/local/bin/rm` → `rm`

### Sub-Command Splitting

Commands are split on `|`, `;`, `&` to check each sub-command independently.

## Deny Response Format

All denials return a structured message:

```
BLOCKED by bureau safety hooks

Reason: <specific reason>

Command: <original command>

If this operation is truly needed, ask the user for explicit
permission and have them run the command manually.
```

Secret read denials include the tool name and file path.

## Related Docs

- [Agent Lifecycle](agent-lifecycle.md) — How hooks are injected into sessions
- [Server Architecture](server-architecture.md) — Overall server structure
