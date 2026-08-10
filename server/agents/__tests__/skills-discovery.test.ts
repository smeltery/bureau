// The bundled-skill `alias:` mechanism, which had no coverage until a bundled
// skill started depending on it.
//
// bureau shipped `bureau-review` from the first commit; a later port added
// `bureau-subagent-review` as a SECOND directory whose SKILL.md was identical
// but for its `name:` field. Two entries, one behaviour, and the docs named only
// the newer one. Collapsing them to one directory plus an alias is only correct
// if the alias resolves for INVOCATION and not merely for display — the help
// renderer and the skills browser both read `aliasFor`, so a display-only alias
// would look right in every list and then fail the one time somebody typed it.
// That is the property these tests pin.

import { describe, expect, test } from "bun:test";
import { discoverBundledSkills, resolveSkillPrompt } from "../skills-discovery.ts";

const CANONICAL = "bureau-review";
const ALIAS = "bureau-subagent-review";

describe("bundled skill aliases", () => {
  test("both the canonical name and its alias are discovered", () => {
    const skills = discoverBundledSkills();
    const canonical = skills.find((s) => s.name === CANONICAL);
    const alias = skills.find((s) => s.name === ALIAS);

    expect(canonical).toBeDefined();
    expect(alias).toBeDefined();
    // Only the alias entry points elsewhere; that is what lets /help collapse
    // the pair into one line instead of listing the same skill twice.
    expect(canonical?.aliasFor).toBeUndefined();
    expect(alias?.aliasFor).toBe(CANONICAL);
    expect(alias?.description).toBe(canonical?.description);
  });

  test("the alias resolves to a prompt, not just to a list entry", () => {
    const viaAlias = resolveSkillPrompt(ALIAS, process.cwd());
    const viaCanonical = resolveSkillPrompt(CANONICAL, process.cwd());

    expect(viaCanonical).not.toBeNull();
    // The same prompt text, because there is only one file left to read.
    expect(viaAlias).toBe(viaCanonical);
  });

  test("one directory, so the pair cannot drift apart again", () => {
    const names = discoverBundledSkills()
      .filter((s) => !s.aliasFor)
      .map((s) => s.name);
    expect(names).toContain(CANONICAL);
    expect(names).not.toContain(ALIAS);
  });

  test("a name nobody bundles resolves to null rather than the nearest match", () => {
    expect(resolveSkillPrompt("bureau-not-a-skill", process.cwd())).toBeNull();
  });
});
