import { describe, expect, it } from "bun:test";
import { AGENT_TEMPLATES, APPS_REGISTRATION_CLAUSE, FIRST_TURN_CLAUSE, PERSONAL_SOFTWARE_CLAUSE, PLAIN_LANGUAGE_CLAUSE, SCOPE_AGREEMENT_CLAUSE } from "../agent-templates.ts";

function template(label: string) {
  const found = AGENT_TEMPLATES.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`Missing agent template: ${label}`);
  return found;
}

describe("agent template prompts", () => {
  it("includes the shared software workflow and plain-language guardrail", () => {
    for (const agentTemplate of AGENT_TEMPLATES) {
      expect(agentTemplate.customInstructions).toContain(FIRST_TURN_CLAUSE);
      expect(agentTemplate.customInstructions).toContain(PERSONAL_SOFTWARE_CLAUSE);
      expect(agentTemplate.customInstructions).toContain(SCOPE_AGREEMENT_CLAUSE);
      expect(agentTemplate.customInstructions).toContain(APPS_REGISTRATION_CLAUSE);
      expect(agentTemplate.customInstructions).toContain(PLAIN_LANGUAGE_CLAUSE);
    }
  });

  it("guides sensitive records through provider and integration warnings", () => {
    expect(template("Money Planner").customInstructions).toContain("anything you see is shared with OpenAI or Anthropic depending on your backend");
    expect(template("Health Navigator").customInstructions).toContain("Suggest OpenEvidence for medical questions when it fits");
    expect(template("Todo List Assistant").customInstructions).toContain("Claude and ChatGPT support those integrations");
  });

  it("keeps Bureau-specific app registration and shared-office warnings", () => {
    expect(template("Side Project Builder").customInstructions).toContain("The default that works in Bureau without extra setup is TypeScript on Bun");
    expect(template("Trip Planner").customInstructions).toContain("terminal access to the whole filesystem");
  });
});
