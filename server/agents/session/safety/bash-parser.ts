// ---------------------------------------------------------------------------
// Path normalization — handles /bin/rm, /usr/bin/git, etc.
// Ported from wallgame's _normalize_absolute_paths()
// ---------------------------------------------------------------------------

export function normalizeAbsolutePaths(cmd: string): string {
  if (!cmd) return cmd;
  // Normalize /bin/rm, /usr/bin/rm, /usr/local/bin/rm etc. to bare "rm"
  let result = cmd.replace(/^\/(?:\S*\/)*s?bin\/rm(?=\s|$)/, "rm");
  // Same for git
  result = result.replace(/^\/(?:\S*\/)*s?bin\/git(?=\s|$)/, "git");
  return result;
}

// Remove heredoc bodies: <<'EOF' ... EOF, <<"EOF" ... EOF, <<EOF ... EOF.
// The rest of the opening line (`> file`, `| sh`, `&& next`) is kept.
export function stripHeredocBodies(cmd: string): string {
  return cmd
    .replace(/<<-?\s*'([^']+)'([^\n]*)\n[\s\S]*?\n\s*\1(?=\n|$)/g, "$2")
    .replace(/<<-?\s*"([^"]+)"([^\n]*)\n[\s\S]*?\n\s*\1(?=\n|$)/g, "$2")
    .replace(/<<-?\s*(\w+)([^\n]*)\n[\s\S]*?\n\s*\1(?=\n|$)/g, "$2");
}

/**
 * Strip quoted strings and heredocs from a command so that pattern matching
 * only applies to actual command structure, not to message content.
 * Replaces quoted content with empty strings to preserve command structure.
 */
export function stripQuotedStrings(cmd: string): string {
  let result = stripHeredocBodies(cmd);
  // Remove double-quoted strings (handling escaped quotes)
  result = result.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  // Remove single-quoted strings (no escaping in single quotes)
  result = result.replace(/'[^']*'/g, "''");
  // Remove $'...' ANSI-C quoting
  result = result.replace(/\$'(?:[^'\\]|\\.)*'/g, "''");
  return result;
}
