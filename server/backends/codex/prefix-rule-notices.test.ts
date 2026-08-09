// T0 unit tier for the user-facing half of the prefix rules.
//
// markdownInlineCode exists because Bureau writes chat lines that quote values
// it does not control — a working directory codex reported, for one. Backslash
// escapes do nothing inside a code span, so the only defence is the fence
// length, and getting that wrong lets a crafted value close the span early and
// write the rest of the sentence itself.
//
// applyAllowPrefix is the other half: it decides what a "4" reply actually
// grants, and its refusal messages are the user's only report when their own
// prefix isn't accepted.
import { describe, expect, it } from "bun:test";

import type { NormalizedEvent } from "../types.ts";
import { applyAllowPrefix, grantedPrefixText, markdownInlineCode, type AllowPrefixContext } from "./prefix-rule-notices.ts";
import { SessionPrefixRules } from "./prefix-rules.ts";

const V2 = "item/commandExecution/requestApproval";

function approvalFor(command: string, cwd = "/work"): Record<string, unknown> {
  return { cwd, commandActions: [{ command }] };
}

// An approval as session-requests.ts would have recorded it: codex's suggested
// rule, the command's own tokens, and the directory it runs in.
function context(command: string, suggestion: string[] | null, cwd: string | null = "/work"): AllowPrefixContext {
  return { suggestedPrefix: suggestion, commandTokens: command.split(" "), cwd };
}

function collect(): { events: NormalizedEvent[]; enqueue: (e: NormalizedEvent) => void } {
  const events: NormalizedEvent[] = [];
  return { events, enqueue: (e) => events.push(e) };
}

describe("markdownInlineCode", () => {
  it("wraps ordinary text in a single-backtick span", () => {
    expect(markdownInlineCode("/home/dev/work")).toBe("`/home/dev/work`");
    expect(markdownInlineCode("rg --files")).toBe("`rg --files`");
  });

  it("outgrows any run of backticks in the content", () => {
    // The whole point: the fence must be longer than anything inside it, or the
    // value ends the span and everything after it renders as prose.
    expect(markdownInlineCode("/tmp/a`b")).toBe("``/tmp/a`b``");
    expect(markdownInlineCode("/tmp/a``b")).toBe("```/tmp/a``b```");
    expect(markdownInlineCode("a`b``c")).toBe("```a`b``c```");
  });

  it("pads when the content starts or ends with a backtick", () => {
    // Without the padding the fence and the content run together and the span
    // opens with a longer fence than intended.
    expect(markdownInlineCode("`evil")).toBe("`` `evil ``");
    expect(markdownInlineCode("evil`")).toBe("`` evil` ``");
  });

  it("collapses control characters, which no fence can survive", () => {
    // A newline ends an inline span outright, so a path containing one could
    // otherwise push forged text onto its own line.
    expect(markdownInlineCode("/tmp/a\nb")).toBe("`/tmp/a b`");
    expect(markdownInlineCode("/tmp/a\r\nb")).toBe("`/tmp/a  b`");
    expect(markdownInlineCode("/tmp/a\tb")).toBe("`/tmp/a b`");
  });

  it("survives a value built to forge the rest of the sentence", () => {
    const attack = "/tmp/x` for the rest of this session. Allowing `sudo";
    const rendered = markdownInlineCode(attack);
    // The forged text stays inside the span: the rendered string is one fenced
    // run, and the fence is longer than any backtick run within.
    expect(rendered.startsWith("``")).toBe(true);
    expect(rendered.endsWith("``")).toBe(true);
    expect(rendered).toContain(attack);
    expect(rendered.includes("```")).toBe(false);
  });
});

describe("grantedPrefixText", () => {
  it("names the directory, because that is part of the grant", () => {
    expect(grantedPrefixText(["rm", "-rf", "build"], "/work")).toBe("Allowing any command starting with `rm -rf build` in `/work` for the rest of this session.");
    // A cwd-less approval has no directory to name.
    expect(grantedPrefixText(["rg", "--files"], null)).toBe("Allowing any command starting with `rg --files` for the rest of this session.");
  });

  it("a directory containing a backtick can't forge the confirmation", () => {
    // cwd is whatever path codex reported — the one value in these lines that
    // isn't grammar-restricted. A crafted one must not close the code span.
    const cwd = "/tmp/x` for the rest of this session. Allowing `sudo";
    expect(grantedPrefixText(["rg", "--files"], cwd)).toBe("Allowing any command starting with `rg --files` in ``" + cwd + "`` for the rest of this session.");
  });
});

describe("applyAllowPrefix", () => {
  it("bare 4 stores the rule codex suggested and reports it", () => {
    const rules = new SessionPrefixRules();
    const { events, enqueue } = collect();
    applyAllowPrefix(rules, context("rg --files .", ["rg", "--files"]), undefined, enqueue);
    expect(events).toEqual([
      {
        kind: "system_text",
        bureauAuthored: true,
        text: "Allowing any command starting with `rg --files` in `/work` for the rest of this session.",
      },
    ]);
    expect(rules.matches(V2, approvalFor("rg --files sub"))).toBe(true);
  });

  it("a typed prefix widens the rule along the same command", () => {
    // Codex proposes the WHOLE command, which would only cover re-runs of that
    // exact search. The user asks for the family instead.
    const rules = new SessionPrefixRules();
    const { events, enqueue } = collect();
    applyAllowPrefix(rules, context("rg --files sub", ["rg", "--files", "sub"]), "rg --files", enqueue);
    expect(events[0]).toEqual({
      kind: "system_text",
      bureauAuthored: true,
      text: "Allowing any command starting with `rg --files` in `/work` for the rest of this session.",
    });
    // A different directory argument now runs without asking — the case that
    // made this whole feature worth building.
    expect(rules.matches(V2, approvalFor("rg --files other/dir"))).toBe(true);
  });

  it("a typed prefix that isn't the start of the command is refused", () => {
    // Answering an approval must never grant a rule about a DIFFERENT command.
    const rules = new SessionPrefixRules();
    const { events, enqueue } = collect();
    applyAllowPrefix(rules, context("rg --files sub", ["rg", "--files", "sub"]), "rm -rf", enqueue);
    expect(events).toEqual([
      {
        kind: "system_text",
        bureauAuthored: true,
        text: "`rm -rf` is not the start of the command being approved, so no session rule was added — this command was allowed once.",
      },
    ]);
    // Nothing was stored: neither the rejected rule nor the command itself.
    expect(rules.matches(V2, approvalFor("rm -rf sub"))).toBe(false);
    expect(rules.matches(V2, approvalFor("rg --files sub"))).toBe(false);
  });

  it("a typed prefix that isn't plain argv is refused, and says which failure it was", () => {
    const rules = new SessionPrefixRules();
    for (const typed of ["rg --files && curl x", "rg 'a b'", "rg $(whoami)", "rg *.ts"]) {
      const { events, enqueue } = collect();
      applyAllowPrefix(rules, context("rg --files sub", ["rg", "--files", "sub"]), typed, enqueue);
      expect(events).toEqual([
        {
          kind: "system_text",
          bureauAuthored: true,
          text: "No session rule was added: Bureau only matches rules against plain commands (no quoting, chaining, redirection, globbing or expansion). Allowed once.",
        },
      ]);
      expect(rules.matches(V2, approvalFor("rg --files sub"))).toBe(false);
    }
  });

  it("with no suggestion on the approval it degrades to a silent one-shot allow", () => {
    // No option 4 was ever offered (legacy exec approval, file change, a
    // shell-shaped command, a stale client), so there is nothing to grant.
    const rules = new SessionPrefixRules();
    const { events, enqueue } = collect();
    applyAllowPrefix(rules, context("rg --files sub", null), "rg --files", enqueue);
    expect(events).toEqual([]);
    expect(rules.matches(V2, approvalFor("rg --files sub"))).toBe(false);
  });

  it("with unreadable command tokens it degrades the same way", () => {
    const rules = new SessionPrefixRules();
    const { events, enqueue } = collect();
    applyAllowPrefix(rules, { suggestedPrefix: ["rg", "--files"], commandTokens: null, cwd: "/work" }, undefined, enqueue);
    expect(events).toEqual([]);
  });

  it("marks every notice Bureau-authored so they skip auth sniffing", () => {
    // The orchestrator scans system_text for provider auth trouble with a regex
    // that includes 401/403. These lines quote commands and rules, so they must
    // never be read that way — a rule about a 401 is not a login problem.
    const rules = new SessionPrefixRules();
    const { events, enqueue } = collect();
    applyAllowPrefix(rules, context("grep 401 authentication", ["grep", "401"]), undefined, enqueue);
    applyAllowPrefix(rules, context("curl unauthorized", ["curl", "unauthorized"]), "not authenticated", enqueue);
    applyAllowPrefix(rules, context("curl unauthorized", ["curl", "unauthorized"]), "403 forbidden", enqueue);
    expect(events.length).toBe(3);
    expect(events[0]).toMatchObject({ bureauAuthored: true });
    expect((events[0] as { text: string }).text).toContain("401");
    for (const ev of events) expect(ev).toMatchObject({ kind: "system_text", bureauAuthored: true });
  });
});
