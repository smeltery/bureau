# Skills library

Open **Skills** in the office header or visit `/skills`. Select a Claude or
Codex agent to browse the skills available in its configured environment.
Search by name, description or alias. Bundled aliases share one editor entry;
the **Commands** tab lists built-in commands separately.

The office owner can create, edit and delete personal and project prompts.
Members can browse their own agents' libraries, but shared host and project
files are read-only: managing an agent does not establish ownership of its
filesystem. Packaged Bureau and installed Claude plugin skills are always
read-only. OpenCode does not expose this skill capability.

Claude roots follow the agent's effective `CLAUDE_CONFIG_DIR` (otherwise its
home's `.claude`), including legacy command files, plus the working directory's
`.claude/skills` and `.claude/commands`. Codex roots include its effective
`CODEX_HOME/skills`, personal `.agents/skills`, and the working directory's
`.agents/skills`. Office, room and manager environment overrides are applied in
the same order as agent sessions. Native providers may discover additional
ancestor or system skills; this page manages the explicitly listed directories.
Bureau's slash invocation and autocomplete use the same catalog as this editor.

Create a skill using a lowercase name containing letters, numbers, hyphens or
underscores. The editor writes a `SKILL.md` (or a legacy command `.md` in a
command directory). YAML frontmatter can supply a description. Save conflicts
require reloading rather than silently overwriting someone else's edits.
Deleting removes only the prompt, preserving scripts, references and assets.
A successful change refreshes the selected agent's autocomplete; invocation
reads the latest prompt on disk. Other agents refresh on session initialization.

The HTTP API requires a browser session and authorized agent context. File and
root identifiers are opaque server-derived handles, never paths supplied by the
browser. Reads and writes reject symlinked paths; text files are limited to
256 KiB, directories to 2,000 entries and catalogs to 4,000 prompts. Replacements
use a content version check and an atomic rename. These guards protect the web
API boundary; they do not isolate hostile processes sharing the same OS account.
Malformed or inaccessible libraries produce an explicit error. Autocomplete
logs discovery errors without preventing the office from starting.

Tests cover configured roots, Codex roots, aliases, plugin immutability, API
identity/origin checks, traversal rejection, conflicts, symlinks, bounded text,
and preservation of neighboring assets.
