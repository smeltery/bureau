// ---------------------------------------------------------------------------
// Destructive git + rm command patterns
//    Ported from wallgame/.claude/hooks/git_safety_guard.py
// ---------------------------------------------------------------------------

export const DESTRUCTIVE_PATTERNS: [RegExp, string][] = [
  // Git commands that discard uncommitted changes
  [
    /git\s+checkout\s+--\s+/,
    "git checkout -- discards uncommitted changes permanently. Use 'git stash' first.",
  ],
  [
    /git\s+checkout\s+(?!-b\b)(?!--orphan\b)[^\s]+\s+--\s+/,
    "git checkout <ref> -- <path> overwrites working tree. Use 'git stash' first.",
  ],
  [
    /git\s+restore\s+(?!--staged\b)(?!-S\b)/,
    "git restore discards uncommitted changes. Use 'git stash' or 'git diff' first.",
  ],
  [
    /git\s+restore\s+.*(?:--worktree|-W\b)/,
    "git restore --worktree/-W discards uncommitted changes permanently.",
  ],
  // Git reset variants
  [
    /git\s+reset\s+--hard/,
    "git reset --hard destroys uncommitted changes. Use 'git stash' first.",
  ],
  [
    /git\s+reset\s+--merge/,
    "git reset --merge can lose uncommitted changes.",
  ],
  // Git clean
  [
    /git\s+clean\s+-[a-z]*f/,
    "git clean -f removes untracked files permanently. Review with 'git clean -n' first.",
  ],
  // Force operations
  // Note: (?![-a-z]) ensures we only block bare --force, not --force-with-lease
  [
    /git\s+push\s+.*--force(?![-a-z])/,
    "Force push can destroy remote history. Use --force-with-lease if necessary.",
  ],
  [
    /git\s+push\s+.*-f\b/,
    "Force push (-f) can destroy remote history. Use --force-with-lease if necessary.",
  ],
  [
    /git\s+branch\s+-D\b/,
    "git branch -D force-deletes without merge check. Use -d for safety.",
  ],
  // Filesystem safety — destructive rm commands
  // Note: [rR] because both -r and -R mean recursive in GNU coreutils
  // Specific root/home pattern MUST come before generic pattern
  [
    /rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f[a-zA-Z]*\s+[/~]|rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR][a-zA-Z]*\s+[/~]/,
    "rm -rf on root or home paths is EXTREMELY DANGEROUS. This command will NOT be executed. Ask the user to run it manually if truly needed.",
  ],
  [
    /rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f|rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR]/,
    "rm -rf is destructive and requires human approval. Explain what you want to delete and why, then ask the user to run the command manually.",
  ],
  // Catch rm with separate -r and -f flags (e.g., rm -r -f, rm -f -r)
  [
    /rm\s+(-[a-zA-Z]+\s+)*-[rR]\s+(-[a-zA-Z]+\s+)*-f|rm\s+(-[a-zA-Z]+\s+)*-f\s+(-[a-zA-Z]+\s+)*-[rR]/,
    "rm with separate -r -f flags is destructive and requires human approval.",
  ],
  // Catch rm with long options (--recursive, --force)
  [
    /rm\s+.*--recursive.*--force|rm\s+.*--force.*--recursive/,
    "rm --recursive --force is destructive and requires human approval.",
  ],
  // Git stash drop/clear
  [
    /git\s+stash\s+drop/,
    "git stash drop permanently deletes stashed changes. List stashes first.",
  ],
  [
    /git\s+stash\s+clear/,
    "git stash clear permanently deletes ALL stashed changes.",
  ],
];

// Patterns that are safe even if they match above (allowlist)
export const SAFE_PATTERNS: RegExp[] = [
  /git\s+checkout\s+-b\s+/,                                          // Creating new branch
  /git\s+checkout\s+--orphan\s+/,                                    // Creating orphan branch
  /git\s+restore\s+--staged\s+(?!.*--worktree)(?!.*-W\b)/,          // Unstaging only (safe)
  /git\s+restore\s+-S\s+(?!.*--worktree)(?!.*-W\b)/,                // Unstaging short form (safe)
  /git\s+clean\s+-[a-z]*n[a-z]*/,                                   // Dry run (-n, -fn, -nf, etc.)
  /git\s+clean\s+--dry-run/,                                        // Dry run (long form)
  // Allow rm -rf on temp directories (-rf/-Rf and -fr/-fR flag orderings)
  /rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f[a-zA-Z]*\s+\/tmp\//,
  /rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR][a-zA-Z]*\s+\/tmp\//,
  /rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f[a-zA-Z]*\s+\/var\/tmp\//,
  /rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR][a-zA-Z]*\s+\/var\/tmp\//,
  /rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f[a-zA-Z]*\s+\$TMPDIR\//,
  /rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR][a-zA-Z]*\s+\$TMPDIR\//,
  /rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f[a-zA-Z]*\s+\$\{TMPDIR/,
  /rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR][a-zA-Z]*\s+\$\{TMPDIR/,
  /rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f[a-zA-Z]*\s+"\$TMPDIR\//,
  /rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR][a-zA-Z]*\s+"\$TMPDIR\//,
  /rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f[a-zA-Z]*\s+"\$\{TMPDIR/,
  /rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR][a-zA-Z]*\s+"\$\{TMPDIR/,
  // Separate flags on temp directories
  /rm\s+(-[a-zA-Z]+\s+)*-[rR]\s+(-[a-zA-Z]+\s+)*-f\s+\/tmp\//,
  /rm\s+(-[a-zA-Z]+\s+)*-f\s+(-[a-zA-Z]+\s+)*-[rR]\s+\/tmp\//,
  /rm\s+(-[a-zA-Z]+\s+)*-[rR]\s+(-[a-zA-Z]+\s+)*-f\s+\/var\/tmp\//,
  /rm\s+(-[a-zA-Z]+\s+)*-f\s+(-[a-zA-Z]+\s+)*-[rR]\s+\/var\/tmp\//,
  // Long options on temp directories
  /rm\s+.*--recursive.*--force\s+\/tmp\//,
  /rm\s+.*--force.*--recursive\s+\/tmp\//,
  /rm\s+.*--recursive.*--force\s+\/var\/tmp\//,
  /rm\s+.*--force.*--recursive\s+\/var\/tmp\//,
];
