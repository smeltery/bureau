import { describe, expect, test } from "bun:test";
import { parseDotenv } from "../env-file.ts";

describe("parseDotenv — basic key=value", () => {
  test("parses a single line", () => {
    expect(parseDotenv("FOO=bar")).toEqual({ FOO: "bar" });
  });

  test("parses multiple lines", () => {
    expect(parseDotenv("FOO=1\nBAR=2\nBAZ=3")).toEqual({ FOO: "1", BAR: "2", BAZ: "3" });
  });

  test("ignores blank lines", () => {
    expect(parseDotenv("\n\nFOO=1\n\nBAR=2\n\n")).toEqual({ FOO: "1", BAR: "2" });
  });

  test("handles CRLF line endings", () => {
    expect(parseDotenv("FOO=1\r\nBAR=2\r\n")).toEqual({ FOO: "1", BAR: "2" });
  });

  test("strips a UTF-8 BOM from the first line", () => {
    expect(parseDotenv("\uFEFFFOO=1\n")).toEqual({ FOO: "1" });
  });
});

describe("parseDotenv — comments", () => {
  test("ignores full-line comments", () => {
    expect(parseDotenv("# header\nFOO=1\n# tail")).toEqual({ FOO: "1" });
  });

  test("strips trailing comments preceded by whitespace", () => {
    expect(parseDotenv("FOO=bar # inline note")).toEqual({ FOO: "bar" });
  });

  test("does NOT treat # without leading whitespace as a comment marker (unquoted)", () => {
    // FOO=bar#baz should keep the #baz as part of the value.
    expect(parseDotenv("FOO=bar#baz")).toEqual({ FOO: "bar#baz" });
  });
});

describe("parseDotenv — quoting", () => {
  test("preserves spaces in double-quoted values", () => {
    expect(parseDotenv('FOO="hello world"')).toEqual({ FOO: "hello world" });
  });

  test("preserves spaces in single-quoted values", () => {
    expect(parseDotenv("FOO='hello world'")).toEqual({ FOO: "hello world" });
  });

  test('expands escapes in double-quoted values (\\n, \\r, \\t, \\", \\\\)', () => {
    expect(parseDotenv('FOO="a\\nb"')).toEqual({ FOO: "a\nb" });
    expect(parseDotenv('FOO="a\\tb"')).toEqual({ FOO: "a\tb" });
    expect(parseDotenv('FOO="a\\rb"')).toEqual({ FOO: "a\rb" });
    expect(parseDotenv('FOO="say \\"hi\\""')).toEqual({ FOO: 'say "hi"' });
    expect(parseDotenv('FOO="back\\\\slash"')).toEqual({ FOO: "back\\slash" });
  });

  test("does NOT expand escapes in single-quoted values", () => {
    expect(parseDotenv("FOO='a\\nb'")).toEqual({ FOO: "a\\nb" });
  });

  test("does NOT strip a trailing-comment-looking sequence inside a quoted value", () => {
    expect(parseDotenv('FOO="foo # bar"')).toEqual({ FOO: "foo # bar" });
  });
});

describe("parseDotenv — export prefix", () => {
  test("strips a leading `export ` prefix", () => {
    expect(parseDotenv("export FOO=bar")).toEqual({ FOO: "bar" });
  });

  test("works with quoted values after export", () => {
    expect(parseDotenv('export FOO="hello world"')).toEqual({ FOO: "hello world" });
  });
});

describe("parseDotenv — error cases", () => {
  test("rejects lines without an `=`", () => {
    expect(() => parseDotenv("FOO_NO_EQ\n")).toThrow(/parse error at line 1/);
  });

  test("rejects keys that don't match [A-Za-z_][A-Za-z0-9_]*", () => {
    expect(() => parseDotenv("123KEY=bar")).toThrow(/invalid key/);
    expect(() => parseDotenv("BAD-KEY=bar")).toThrow(/invalid key/);
  });

  test("rejects unterminated quoted values", () => {
    expect(() => parseDotenv('FOO="hello')).toThrow(/unterminated quoted value/);
    expect(() => parseDotenv("FOO='hello")).toThrow(/unterminated quoted value/);
  });

  test("error message includes the 1-based line number", () => {
    expect(() => parseDotenv("FOO=bar\nBROKEN_LINE\n")).toThrow(/line 2/);
  });
});

describe("parseDotenv — edge cases", () => {
  test("empty input returns an empty object", () => {
    expect(parseDotenv("")).toEqual({});
  });

  test("an empty value is allowed", () => {
    expect(parseDotenv("FOO=")).toEqual({ FOO: "" });
  });

  test("the last duplicate key wins", () => {
    expect(parseDotenv("FOO=1\nFOO=2")).toEqual({ FOO: "2" });
  });

  test("trims surrounding whitespace from unquoted values (but preserves it inside quotes)", () => {
    expect(parseDotenv("FOO=  bar  ")).toEqual({ FOO: "bar" });
    expect(parseDotenv('FOO="  bar  "')).toEqual({ FOO: "  bar  " });
  });
});
