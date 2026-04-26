import { describe, expect, test } from "bun:test";
import { normalizeAbsolutePaths, stripQuotedStrings } from "../bash-parser.ts";

describe("normalizeAbsolutePaths", () => {
  test("returns the empty string unchanged", () => {
    expect(normalizeAbsolutePaths("")).toBe("");
  });

  test("normalizes /bin/rm to bare rm", () => {
    expect(normalizeAbsolutePaths("/bin/rm -rf foo")).toBe("rm -rf foo");
  });

  test("normalizes /usr/bin/rm and /usr/local/bin/rm", () => {
    expect(normalizeAbsolutePaths("/usr/bin/rm tmp")).toBe("rm tmp");
    expect(normalizeAbsolutePaths("/usr/local/bin/rm tmp")).toBe("rm tmp");
  });

  test("normalizes /sbin/rm (sbin variant)", () => {
    expect(normalizeAbsolutePaths("/sbin/rm tmp")).toBe("rm tmp");
  });

  test("normalizes /usr/bin/git as well as /bin/git", () => {
    expect(normalizeAbsolutePaths("/usr/bin/git push")).toBe("git push");
    expect(normalizeAbsolutePaths("/bin/git status")).toBe("git status");
  });

  test("only normalizes when the absolute path is the leading token", () => {
    // mid-command paths are intentionally left alone (commands like `xargs
    // /bin/rm` are uncommon and the rule's job is to stop the safety check
    // being defeated by `/bin/rm -rf /`, not to rewrite arbitrary paths).
    expect(normalizeAbsolutePaths("xargs /bin/rm")).toBe("xargs /bin/rm");
  });

  test("leaves non-rm/git absolute paths alone", () => {
    expect(normalizeAbsolutePaths("/bin/ls -la")).toBe("/bin/ls -la");
    expect(normalizeAbsolutePaths("/usr/bin/cat foo")).toBe("/usr/bin/cat foo");
  });

  test("does not strip the trailing args when the boundary requires whitespace or end-of-string", () => {
    // The pattern uses a (?=\s|$) lookahead so /bin/rm-something isn't a hit.
    expect(normalizeAbsolutePaths("/bin/rmtree foo")).toBe("/bin/rmtree foo");
  });
});

describe("stripQuotedStrings", () => {
  test("replaces double-quoted content with empty quotes", () => {
    expect(stripQuotedStrings('echo "hello world"')).toBe('echo ""');
  });

  test("replaces single-quoted content with empty quotes", () => {
    expect(stripQuotedStrings("echo 'rm -rf /'")).toBe("echo ''");
  });

  test("handles escaped double quotes inside double-quoted strings", () => {
    expect(stripQuotedStrings('echo "a \\" b"')).toBe('echo ""');
  });

  test("handles ANSI-C $'...' quoting", () => {
    expect(stripQuotedStrings("printf $'\\nhi'")).toBe("printf ''");
  });

  test("strips heredoc bodies with quoted single-quote delimiter", () => {
    const input = "cat <<'EOF'\nrm -rf /\nEOF";
    expect(stripQuotedStrings(input)).toBe("cat ");
  });

  test("strips heredoc bodies with quoted double-quote delimiter", () => {
    const input = 'cat <<"END"\nrm -rf /\nEND';
    expect(stripQuotedStrings(input)).toBe("cat ");
  });

  test("strips bare-delimiter heredoc bodies", () => {
    const input = "cat <<EOF\nrm -rf /\nEOF";
    expect(stripQuotedStrings(input)).toBe("cat ");
  });

  test("preserves unquoted command structure", () => {
    expect(stripQuotedStrings("git push origin master")).toBe("git push origin master");
  });

  test("strips multiple distinct quoted segments in one command", () => {
    expect(stripQuotedStrings(`echo "first" 'second' "third"`)).toBe(`echo "" '' ""`);
  });

  test("dangerous content hidden inside a quoted echo no longer matches the destructive patterns", () => {
    // The motivating case: ensure `echo "rm -rf /"` doesn't trip the
    // destructive-pattern check after stripping.
    const stripped = stripQuotedStrings('echo "rm -rf /"');
    expect(stripped).not.toContain("rm");
    expect(stripped).toBe('echo ""');
  });
});
