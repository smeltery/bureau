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

/**
 * Strip quoted strings and heredocs from a command so that pattern matching
 * only applies to actual command structure, not to message content.
 * Replaces quoted content with empty strings to preserve command structure.
 */
export function stripQuotedStrings(cmd: string): string {
  let result = cmd;
  // Remove heredoc bodies: <<'EOF' ... EOF, <<"EOF" ... EOF, <<EOF ... EOF
  result = result.replace(/<<-?\s*'([^']+)'\s*\n[\s\S]*?\n\s*\1/g, "");
  result = result.replace(/<<-?\s*"([^"]+)"\s*\n[\s\S]*?\n\s*\1/g, "");
  result = result.replace(/<<-?\s*(\w+)\s*\n[\s\S]*?\n\s*\1/g, "");
  // Remove double-quoted strings (handling escaped quotes)
  result = result.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  // Remove single-quoted strings (no escaping in single quotes)
  result = result.replace(/'[^']*'/g, "''");
  // Remove $'...' ANSI-C quoting
  result = result.replace(/\$'(?:[^'\\]|\\.)*'/g, "''");
  return result;
}
