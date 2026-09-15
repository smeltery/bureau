import { describe, expect, it } from "bun:test";
import {
  AGENT_TEMPLATES,
  APPS_REGISTRATION_CLAUSE,
  FIRST_TURN_CLAUSE,
  PERSONAL_SOFTWARE_CLAUSE,
  PLAIN_LANGUAGE_CLAUSE,
  SCOPE_AGREEMENT_CLAUSE,
  templateFormValues,
  templateInstructionsEn,
  templateLabel,
} from "../agent-templates.ts";

function template(key: string) {
  const found = AGENT_TEMPLATES.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`Missing agent template: ${key}`);
  return found;
}

describe("agent template prompts", () => {
  it("includes the shared software workflow and plain-language guardrail", () => {
    for (const agentTemplate of AGENT_TEMPLATES) {
      const instructions = templateInstructionsEn(agentTemplate);
      expect(instructions).toContain(FIRST_TURN_CLAUSE);
      expect(instructions).toContain(PERSONAL_SOFTWARE_CLAUSE);
      expect(instructions).toContain(SCOPE_AGREEMENT_CLAUSE);
      expect(instructions).toContain(APPS_REGISTRATION_CLAUSE);
      expect(instructions).toContain(PLAIN_LANGUAGE_CLAUSE);
    }
  });

  it("guides sensitive records through provider and integration warnings", () => {
    expect(templateInstructionsEn(template("money-planner"))).toContain("anything you see is shared with OpenAI or Anthropic depending on your backend");
    expect(templateInstructionsEn(template("health-navigator"))).toContain("Suggest OpenEvidence for medical questions when it fits");
    expect(templateInstructionsEn(template("todo-list-assistant"))).toContain("Claude and ChatGPT support those integrations");
  });

  it("keeps Bureau-specific app registration and shared-office warnings", () => {
    expect(templateInstructionsEn(template("side-project-builder"))).toContain("The default that works in Bureau without extra setup is TypeScript on Bun");
    expect(templateInstructionsEn(template("trip-planner"))).toContain("terminal access to the whole filesystem");
  });

  it("matches specialist costumes to builder and health templates", () => {
    expect(template("side-project-builder").outfit.costume).toBe("construction");
    expect(template("personal-site-builder").outfit.costume).toBe("construction");
    expect(template("health-navigator").outfit.costume).toBe("doctor");
  });

  it("fills spawn form values in the member language", () => {
    const baseline = { modelFamily: "opus", effort: "high" as const, permissionMode: "default" as const };
    const en = templateFormValues(template("side-project-builder"), "claude", baseline, "en");
    const es = templateFormValues(template("side-project-builder"), "claude", baseline, "es");
    expect(en.name).toBe("Side Project Builder");
    expect(es.name).toBe(templateLabel(template("side-project-builder"), "es"));
    expect(es.name).not.toBe(en.name);
    expect(es.customInstructions).not.toBe(en.customInstructions);
    expect(es.customInstructions).toContain("Bureau");
  });
});
