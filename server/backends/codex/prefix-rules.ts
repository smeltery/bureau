// Session-scoped "stop asking me about `rg --files`" rules for codex exec
// approvals.
//
// Everything in here is pure except SessionPrefixRules, whose entire store is
// one in-memory array owned by a single CodexSession. The tempting alternative
// — handing codex back its own `acceptWithExecpolicyAmendment` — was rejected:
// codex writes the accepted rule to $CODEX_HOME/rules/default.rules, which is
// durable AND shared by every codex agent in the office (they share one
// CODEX_HOME). One user's "stop asking me" would silently become a permanent
// office-wide allow. So Bureau never sends that decision; it remembers the
// rule itself and answers codex with a plain one-shot allow.

// One token of a "plain argv" command line. This is an ALLOWLIST on purpose:
// a denylist of shell metacharacters is one forgotten character (or one new
// shell feature) away from matching a rule against something the user never
// agreed to. Everything outside this set — quoting, escaping, expansion,
// globbing, redirection, chaining, comments, braces, tildes, control
// characters, anything non-ASCII — puts the command outside the matcher
// entirely, and it gets a prompt like any other.
const PLAIN_ARGV_TOKEN = /^[A-Za-z0-9_./:@%+=,-]+$/;

// One session-scoped allow: a command prefix plus the directory it applies to.
export interface AllowPrefixRule {
  tokens: string[];
  cwd: string | null;
}

export function isExecApprovalMethod(method: string): boolean {
  return method === "execCommandApproval" || method === "item/commandExecution/requestApproval";
}

// Split a plain-argv command line into tokens, or null if it isn't one. The
// single place that decides what "a token" means; both the command codex sent
// and any prefix the user typed go through it.
export function splitPlainArgv(text: string): string[] | null {
  const tokens = text.split(" ").filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  if (!tokens.every((t) => PLAIN_ARGV_TOKEN.test(t))) return null;
  return tokens;
}

// Whole-token prefix test. Substring matching would be wrong in exactly the
// dangerous direction: `git lo` must not cover `git log`, and `rg` must not
// cover `rgrep`.
export function tokensStartWith(tokens: string[], prefix: string[]): boolean {
  if (prefix.length === 0 || prefix.length > tokens.length) return false;
  return prefix.every((token, i) => tokens[i] === token);
}

// The tokens of the single command this approval is about, or null when we
// can't be sure what "the command" is. Null means "ask the user", and every
// uncertain case lands there:
//   - not exactly one parsed command action (nothing unambiguous to match)
//   - a missing or non-string command
//   - a command that isn't plain argv by the grammar above
// Note what this deliberately does NOT do: it reads `commandActions` only to
// pick out the one command STRING codex is about to run, and re-derives the
// tokens itself. Codex's own parse (the action `type`, its `path` field, its
// suggested amendment) is never treated as authority over what will execute.
//
// Runs of spaces collapse — `rg  --files` and `rg --files` are the same
// command line. Any other whitespace (tab, newline, CR) stays inside its
// token and is rejected by the grammar.
export function commandTokensForPrefixMatch(params: unknown): string[] | null {
  if (!params || typeof params !== "object") return null;
  const actions = (params as Record<string, unknown>).commandActions;
  if (!Array.isArray(actions) || actions.length !== 1) return null;
  const command = (actions[0] as { command?: unknown } | null)?.command;
  if (typeof command !== "string") return null;
  return splitPlainArgv(command);
}

// The directory a command approval would run in. Null when absent or not a
// string, which simply makes it its own scope — rules granted from such an
// approval only ever match other approvals that are equally cwd-less.
export function approvalCwd(params: unknown): string | null {
  if (!params || typeof params !== "object") return null;
  const cwd = (params as Record<string, unknown>).cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : null;
}

// The prefix rule this approval may offer, or null for "no option 4 here".
// Codex suggests one in `proposedExecpolicyAmendment` — its own idea of "the
// rule that would stop this prompt coming back", e.g. ["rg", "--files"] — and
// this is where that suggestion has to earn its place. Four gates, all
// required:
//
//   1. The exact v2 method. Not "is this an exec approval": the legacy
//      execCommandApproval has no such field today, and if some future codex
//      grew one we would rather not have quietly sprouted a new option on a
//      path nobody designed for it.
//   2. The command itself must be plain argv. A chained or quoted command
//      can't be covered by a rule at all, so offering the option would be
//      offering something guaranteed to be refused.
//   3. Every suggested token must be plain argv too. That is display safety
//      as much as matching: the tokens are shown back inside backticks, and a
//      token holding whitespace or a backtick would render an ambiguous — or
//      forged — rule in the prompt.
//   4. The suggestion must be the START of the command being approved. This
//      is the one that matters: without it, a request could ask to run
//      command A while suggesting a perfectly innocuous-looking rule B, and
//      a user answering "4" about A would be storing a rule about B. The
//      invariant is the same one typed prefixes obey — a rule can only ever
//      describe the command in front of you.
export function offerablePrefix(method: string, params: unknown, commandTokens: string[] | null): string[] | null {
  if (method !== "item/commandExecution/requestApproval") return null;
  if (!commandTokens) return null;
  if (!params || typeof params !== "object") return null;
  const raw = (params as Record<string, unknown>).proposedExecpolicyAmendment;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every((t) => typeof t === "string" && PLAIN_ARGV_TOKEN.test(t))) return null;
  const suggestion = raw as string[];
  if (!tokensStartWith(commandTokens, suggestion)) return null;
  return suggestion;
}

// Does rule `a` already cover everything rule `b` would allow?
function ruleCovers(a: AllowPrefixRule, b: AllowPrefixRule): boolean {
  return a.cwd === b.cwd && tokensStartWith(b.tokens, a.tokens);
}

// Command prefixes the user chose to stop being asked about, each pinned to
// the directory it was granted in (e.g. ["rg", "--files"] in /work).
// Populated only by an explicit `allow_prefix` decision; a later exec
// approval that starts the same way in the same directory is answered without
// bothering the user.
//
// DELIBERATELY in-memory and per-session: this object IS the whole store. One
// instance is a field of one CodexSession, so it dies with the session
// (/clear, resume, restart, session swap) and no other agent can see it.
export class SessionPrefixRules {
  private rules: AllowPrefixRule[] = [];

  // Store a prefix rule for the rest of this session. A rule already covered
  // by a broader one is dropped, and adding a broader rule drops the narrower
  // ones it swallows, so the list stays as small as the user's actual choices
  // allow. (It still grows one entry per genuinely distinct choice — that is
  // the user's own doing and is bounded by how many times they answer "4".)
  remember(prefix: string[], cwd: string | null): void {
    if (prefix.length === 0) return;
    // Copy: the caller's array is held elsewhere (pending approval state), and
    // a stored rule must not change under us afterwards.
    const rule: AllowPrefixRule = { tokens: [...prefix], cwd };
    if (this.rules.some((r) => ruleCovers(r, rule))) return;
    this.rules = this.rules.filter((r) => !ruleCovers(rule, r));
    this.rules.push(rule);
  }

  // Does the command this approval is about start with a prefix the user
  // already allowed for this session, in the same directory? False for
  // anything that isn't a command execution, for requests we can't read a
  // single unambiguous command out of, and for any command that isn't plain
  // argv — see commandTokensForPrefixMatch, which fails closed.
  matches(method: string, params: unknown): boolean {
    if (this.rules.length === 0) return false;
    if (!isExecApprovalMethod(method)) return false;
    const tokens = commandTokensForPrefixMatch(params);
    if (!tokens) return false;
    const cwd = approvalCwd(params);
    return this.rules.some((rule) => rule.cwd === cwd && tokensStartWith(tokens, rule.tokens));
  }
}
