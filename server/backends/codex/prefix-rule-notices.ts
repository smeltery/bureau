// User-facing half of the session-scoped prefix rules: turning an
// "allow, and stop asking" decision into an actual rule, and saying out loud
// what was remembered. These breadcrumbs are the only report the user gets,
// so they have to name the real rule — including when their own prefix is
// refused.

import type { NormalizedEvent } from "../types.ts";
import { splitPlainArgv, tokensStartWith, type SessionPrefixRules } from "./prefix-rules.ts";

// The fields an approval has to carry for option 4 to mean anything. Kept as
// its own shape rather than importing the full PendingApproval so this module
// depends on nothing but the rule store.
export interface AllowPrefixContext {
  // The prefix rule codex suggested for this exec approval, if any (its
  // `proposedExecpolicyAmendment`). Held on our side, never sent back to the
  // orchestrator or to codex.
  suggestedPrefix: string[] | null;
  // Tokens of the command this approval is about, when we could read them
  // unambiguously (see commandTokensForPrefixMatch). A user-typed prefix is
  // only accepted if it is the start of THESE tokens, so answering one
  // approval can never grant a rule about some other command.
  commandTokens: string[] | null;
  // The directory this command would run in. Part of any rule granted from
  // this approval — the same argv in another tree is another action.
  cwd: string | null;
}

// The breadcrumb emitted when a rule the user set earlier answers an approval
// on its own. Deliberately generic: it fires once per matched command, and the
// command itself is right there in the tool call it precedes, so naming the
// rule adds nothing — while quoting rule text on a repeating line is exactly
// what we don't want in the log.
export const AUTO_APPROVED_BY_PREFIX_RULE = "Auto-approved by a command-prefix rule for this session.";

// Render an untrusted string as a markdown INLINE CODE SPAN, safely.
//
// Backslash escapes don't work inside code spans, so the usual trick is no
// help here: the only thing that ends a span is a run of backticks at least as
// long as the one that opened it. So we open with one backtick more than the
// longest run in the content, which no content can close early. Content that
// starts or ends with a backtick gets one space of padding, which CommonMark
// strips back off when both sides have it.
//
// Control characters collapse to spaces because no fence can survive them: a
// newline ends an inline span outright and no escape can tame it. Paths with
// newlines in them are pathological, but "pathological" is exactly what a
// display helper has to survive.
export function markdownInlineCode(text: string): string {
  let body = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    body += code < 0x20 || code === 0x7f ? " " : ch;
  }
  let longestRun = 0;
  let run = 0;
  for (const ch of body) {
    run = ch === "`" ? run + 1 : 0;
    if (run > longestRun) longestRun = run;
  }
  const fence = "`".repeat(longestRun + 1);
  const pad = body.startsWith("`") || body.endsWith("`") ? " " : "";
  return `${fence}${pad}${body}${pad}${fence}`;
}

// A rule names a directory as well as a command prefix: `rm -rf build` means
// a different thing in a different tree, and codex can run a command with a
// workdir of its choosing. Naming the directory in the confirmation is the
// point — the user should see the scope they just granted, not discover it.
//
// The prefix is safe to interpolate by construction (every token satisfies the
// plain-argv grammar, which has no backticks in it). The cwd is not: it is
// whatever path codex sent, and a directory holding a backtick could close the
// code span early and forge the rest of the sentence.
export function grantedPrefixText(prefix: string[], cwd: string | null): string {
  const where = cwd ? ` in ${markdownInlineCode(cwd)}` : "";
  return `Allowing any command starting with \`${prefix.join(" ")}\`${where} for the rest of this session.`;
}

// Resolve an "allow, and stop asking" decision into an actual rule and report
// what was remembered.
//
// The orchestrator hands over the user's RAW TEXT, not tokens: splitting a
// command line and deciding what counts as a token is Codex-shaped knowledge
// and stays on this side of the boundary. What the text is checked against is
// the command being approved — a typed prefix must be its start. That single
// rule is what keeps this from being a way to grant arbitrary permissions: you
// can widen along the command in front of you, never sideways to a command you
// were never asked about.
export function applyAllowPrefix(rules: SessionPrefixRules, pending: AllowPrefixContext, typedText: string | undefined, enqueue: (event: NormalizedEvent) => void): void {
  // Option 4 is only ever offered when this approval carried a rule that
  // passed every gate in offerablePrefix, so an allow_prefix arriving without
  // one (legacy exec approvals, file changes, a shell-shaped command, a stale
  // client) has nothing to grant: it degrades to a plain one-shot allow,
  // silently and with no rule stored. Its presence also means commandTokens is
  // non-null — gate 2 of offerablePrefix.
  if (!pending.suggestedPrefix || !pending.commandTokens) return;
  const typed = typedText ? splitPlainArgv(typedText) : null;
  if (typedText && typedText.trim()) {
    if (!typed) {
      // The user typed something that isn't a plain command, so there is no
      // honest rule to store. Say which failure this is — otherwise they
      // retype a prefix that looks obviously correct and it fails again.
      enqueue({
        kind: "system_text",
        bureauAuthored: true,
        text: `No session rule was added: Bureau only matches rules against plain commands (no quoting, chaining, redirection, globbing or expansion). Allowed once.`,
      });
    } else if (tokensStartWith(pending.commandTokens, typed)) {
      rules.remember(typed, pending.cwd);
      enqueue({
        kind: "system_text",
        bureauAuthored: true,
        text: grantedPrefixText(typed, pending.cwd),
      });
    } else {
      enqueue({
        kind: "system_text",
        bureauAuthored: true,
        text: `\`${typed.join(" ")}\` is not the start of the command being approved, so no session rule was added — this command was allowed once.`,
      });
    }
    return;
  }
  rules.remember(pending.suggestedPrefix, pending.cwd);
  enqueue({
    kind: "system_text",
    bureauAuthored: true,
    text: grantedPrefixText(pending.suggestedPrefix, pending.cwd),
  });
}
