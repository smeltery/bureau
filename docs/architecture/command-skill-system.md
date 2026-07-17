# Command & Skill System

Bureau manages slash commands and skills from multiple sources, each with different priority levels and override rules. The command registry lives in `server/agents/commands.ts`; skill discovery is in `server/agents/skills-discovery.ts`; the dispatch logic (`handleSlashCommand`, `commandHandlers`, `executeSkill`) lives in `server/agents/conversation/slash-commands.ts`.

## Command Types

### Hardcoded Commands

Commands with Bureau-side handlers. Defined in the `commands` registry with `type: "hardcoded"` and `supported: true`:

| Command                          | Handler                       | Description                                            |
| -------------------------------- | ----------------------------- | ------------------------------------------------------ |
| `/clear`                         | `clear`                       | Wipe conversation history                              |
| `/context`                       | `context`                     | Visualize context window usage                         |
| `/help`                          | `help`                        | List all available commands                            |
| `/bureau-usage`                  | `bureauUsage`                 | Per-agent / per-room / per-cron-job token spend        |
| `/resume`                        | `resume`                      | Pick up a previous session                             |
| `/usage`                         | `usage`                       | Where to check subscription and office usage           |
| `/model`                         | `model`                       | Switch model                                           |
| `/effort`                        | `effort`                      | Switch thinking effort level                           |
| `/bureau-all-hands`              | `bureauAllHands`              | Summary of all agents                                  |
| `/bureau-system-prompt`          | `bureauSystemPrompt`          | Show the full system prompt                            |
| `/bureau-cronjob-system-prompt`  | `bureauCronjobSystemPrompt`   | Show the system prompt a cron job receives             |
| `/bureau-diff`                   | `bureauDiff`                  | Peek uncommitted changes in cwd                        |
| `/bureau-edit`                   | `bureauEdit`                  | Open a file in the editor side panel                   |
| `/reset`                         | `clear`                       | Alias for `/clear`                                     |
| `/new`                           | `clear`                       | Alias for `/clear`                                     |

### Unsupported Hardcoded Commands

Claude Code commands that Bureau doesn't implement. These return type-aware "not supported" messages:

- **Session**: `/compact`, `/branch`, `/fork`, `/export`, `/plan`, `/rename`
- **Model**: `/fast`, `/advisor`
- **Cost**: `/cost` (API-only, Bureau uses subscription), `/stats`
- **Files**: `/diff`, `/rewind`, `/checkpoint`, `/copy`, `/files`, `/add-dir`
- **Config**: `/config`, `/settings`, `/hooks`, `/permissions`, `/memory`, `/mcp`, `/agents`, `/skills`, `/sandbox`
- **System**: `/tasks`, `/bashes`, `/doctor`, `/feedback`, `/bug`, `/status`, `/tag`, `/init`

Some have custom messages (e.g., `/login` directs to the built-in terminal, `/plugin` gives step-by-step instructions). Bureau's native bug-reporting flow is the bundled `/report-bureau-bug` skill rather than Claude Code's `/bug` command.

### Bundled Skills

Claude Code skills bundled with Bureau, overridable by user/project skills:

`/bureau-pair-programming`, `/bureau-peer-review`, `/bureau-review`, `/bureau-review-and-commit`, `/bureau-second-opinion`, `/bureau-soft-handoff`, `/bureau-subagent-review`, `/grill-me`, `/report-bureau-bug`

Claude Code bundled skills that Bureau knows about but does not implement natively:

`/batch`, `/claude-api`, `/claude-in-chrome`, `/debug`, `/loop`, `/review`, `/schedule`, `/security-review`, `/simplify`, `/skillify`, `/stuck`, `/ultrareview`

## Skill Discovery

Skills are discovered from four sources, scanned in priority order:

### 1. User Skills (`~/.claude/skills/<name>/SKILL.md`)

Global user-defined skills. Highest priority after hardcoded commands.

### 2. Project Skills (`<cwd>/.claude/commands/<name>.md`)

Per-project commands discovered from the agent's working directory.

### 3. Plugin Skills (`~/.claude/plugins/installed_plugins.json`)

Skills from installed Claude Code plugins. Scanned from each plugin's `skills/` and `commands/` directories. Respects `user-invocable: false` frontmatter.

### 4. Bureau Skills (`skills/<name>/SKILL.md`)

Skills bundled with Bureau itself. Lowest priority, overridable by all above.

### Priority Hierarchy

```
Hardcoded commands (highest)
  ↓
Enterprise skills
  ↓
User skills (~/.claude/skills/)
  ↓
Project skills (<cwd>/.claude/commands/)
  ↓
Bureau skills (priority 4.5)
  ↓
Claude Code bundled skills (lowest)
```

Name clashes are resolved by keeping the first (highest-priority) occurrence.

## Skill Scanning

Skills are discovered by scanning the filesystem for `SKILL.md` files and `.md` command files:

```typescript
function discoverUserSkills(): SkillInfo[] {
  // Scan ~/.claude/skills/<name>/SKILL.md
  // Scan ~/.claude/commands/<name>.md
}

function discoverProjectSkills(cwd: string): SkillInfo[] {
  // Scan <cwd>/.claude/commands/<name>.md
}

function discoverPluginSkills(): SkillInfo[] {
  // Scan ~/.claude/plugins/installed_plugins.json
  // For each plugin: skills/<name>/SKILL.md + commands/<name>.md
}

function discoverBundledSkills(): SkillInfo[] {
  // Scan skills/<name>/SKILL.md (bundled with Bureau)
}
```

Each skill's description is extracted from the YAML frontmatter (`description: ...`).

## SDK-Reported Commands

On `system:init`, the SDK reports available slash commands via `msg.slash_commands`. Bureau:

1. Filters out MCP internal commands (`mcp__...` prefix) — they clutter autocomplete.
2. Stores them for pass-through resolution (step 4 in the priority chain).
3. Does **not** add them to autocomplete (per design decision).

## Autocomplete

Only commands with `autocomplete: true` appear in the slash command autocomplete UI. This includes:

- Supported hardcoded commands
- Discovered skills (user, project, plugin, bureau)

SDK-reported commands are excluded from autocomplete to avoid noise from MCP internals.

## Command Handling Flow

When a user types `/command`:

1. **Check hardcoded registry**: If `supported: true`, dispatch to the handler in `server/agents/conversation/slash-commands.ts` (the `commandHandlers` record).
2. **Check hardcoded registry**: If `supported: false`, return the unsupported message.
3. **Check discovered skills**: If found, pass through to the SDK (the SDK handles skill execution).
4. **Check SDK-reported commands**: If found, pass through to the SDK.
5. **Not found**: Return "`/command` is not available in Bureau."

## Command Config Schema

```typescript
type CommandConfig = {
  type: "hardcoded" | "bundled-skill";
  supported: boolean; // Does Bureau handle this?
  autocomplete: boolean; // Show in autocomplete?
  overridable: boolean; // Can skills shadow this?
  handler?: string; // Handler key (required when supported)
  description?: string; // Short description
  message?: string; // Custom unsupported message
};
```

## Related Docs

- [Agent Lifecycle](agent-lifecycle.md) — How commands are dispatched to handlers
- [Safety Hooks](safety-hooks.md) — PreToolUse hooks that protect command execution
- [Skills Investigation](../investigations/skills-investigation.md) — Deep dive into skill architecture
