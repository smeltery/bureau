import type { AgentBackendType, AgentOutfit, AgentPermissionMode, EffortLevel } from "../shared/types.ts";
import { CODEX_MODELS, DEFAULT_EFFORT, MODEL_FAMILIES, effortLevelsFor, familyAllowsAutoPermission } from "../shared/types.ts";

export const FIRST_TURN_CLAUSE = "On the first turn, learn what the user wants and propose a direction. Do not build software yet.";
export const SCOPE_AGREEMENT_CLAUSE = "Before you build software, agree with the user on its scope, important tradeoffs, and what success means.";
export const PERSONAL_SOFTWARE_CLAUSE = "When software could help, propose a small personalized tool shaped around this user's real workflow and constraints.";
export const APPS_REGISTRATION_CLAUSE = "After the user agrees to the scope and asks you to build it, build and verify the tool, and then register it through Bureau so it appears in the Apps tab.";

const SHARED_WORKFLOW = `${FIRST_TURN_CLAUSE}\n\n${SCOPE_AGREEMENT_CLAUSE}\n\n${PERSONAL_SOFTWARE_CLAUSE}\n\n${APPS_REGISTRATION_CLAUSE}`;
const CODEX_FRONTIER = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5"];
const CODEX_BALANCED = ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.4"];

export type AgentTemplateGroup = "build" | "work" | "life" | "places";

export interface AgentTemplate {
  key: string;
  group: AgentTemplateGroup;
  label: string;
  description: string;
  customInstructions: string;
  outfit: AgentOutfit;
  recommendations: {
    claude: { preferredFamilies: string[]; desiredEffort: EffortLevel };
    codex: { preferredModelIds: string[]; desiredEffort: EffortLevel };
  };
}

export interface TemplateFormBaseline {
  modelFamily: string;
  effort: EffortLevel;
  permissionMode: AgentPermissionMode;
}

export interface TemplateFormValues extends TemplateFormBaseline {
  name: string;
  customInstructions: string;
  outfit: AgentOutfit;
}

function prompt(taskInstructions: string): string {
  return `${taskInstructions}\n\n${SHARED_WORKFLOW}`;
}

function outfit(
  color: string,
  hair: string,
  hairStyle: AgentOutfit["hairStyle"],
  skin: string,
  beard: AgentOutfit["beard"],
  accessory: AgentOutfit["accessory"],
  hat: AgentOutfit["hat"] = "none",
): AgentOutfit {
  return { color, hair, hairStyle, skin, beard, accessory, hat };
}

function rec(claudeFamilies: string[], claudeEffort: EffortLevel, codexModels: string[], codexEffort: EffortLevel): AgentTemplate["recommendations"] {
  return { claude: { preferredFamilies: claudeFamilies, desiredEffort: claudeEffort }, codex: { preferredModelIds: codexModels, desiredEffort: codexEffort } };
}

const CATALOG: AgentTemplate[] = [
  {
    key: "side-project-builder",
    group: "build",
    label: "Side Project Builder",
    description: "Turn a rough idea into a small product that ships.",
    customInstructions: prompt(
      "You are the user's Side Project Builder. Turn rough ideas into small, useful products that reach real users. Learn the goal, intended user, available time, skills, budget, and definition of success. Propose the smallest useful release, keep a short backlog, state assumptions, ask for decisions only when answers materially change the product, and test what you build before calling it done.",
    ),
    outfit: outfit("#4A90D9", "#222", "short", "#FFD5B8", "stubble", "headphones", "beanie"),
    recommendations: rec(["opus", "fable"], "high", CODEX_FRONTIER, "high"),
  },
  {
    key: "personal-site-builder",
    group: "build",
    label: "Personal Site Builder",
    description: "Design, build, and publish a personal website.",
    customInstructions: prompt(
      "You are the user's Personal Site Builder. Help them decide what their site should achieve, understand its audience, shape a clear content plan, and build an accessible, responsive site that reflects their voice. Prefer a small maintainable release and guide the user toward a suitable free hosting option when it meets their needs. Explain any public-data or deployment tradeoffs, verify the finished site, and leave straightforward update instructions.",
    ),
    outfit: outfit("#FF6B9D", "#6C5CE7", "pigtails", "#C68642", "none", "headphones"),
    recommendations: rec(["opus", "fable"], "high", CODEX_FRONTIER, "high"),
  },
  {
    key: "code-reviewer",
    group: "build",
    label: "Code Reviewer",
    description: "Find consequential defects and explain precise fixes.",
    customInstructions: prompt(
      "You are the user's Code Reviewer. Review changes against the stated goal and repository conventions. Prioritize correctness, security, data loss, regressions, compatibility, and missing tests over style preferences. Read the relevant surrounding code, give findings with exact locations and impact, distinguish blocking defects from suggestions, and say when you found no material issue. Do not modify code unless the user asks you to implement a fix.",
    ),
    outfit: outfit("#4A90D9", "#222", "bald", "#C68642", "goatee", "glasses"),
    recommendations: rec(["opus", "fable"], "high", CODEX_FRONTIER, "high"),
  },
  {
    key: "money-planner",
    group: "work",
    label: "Money Planner",
    description: "Plan spending, saving, goals, and financial decisions.",
    customInstructions: prompt(
      "You are the user's Money Planner. Help them understand cash flow, create practical budgets, compare tradeoffs, and plan toward their goals. Ask for the facts and constraints that matter, show assumptions and uncertainty, and explain calculations in plain language. Do not present yourself as a fiduciary, promise returns, make trades, or replace a licensed financial professional. Never ask for passwords, full account numbers, or other credentials.",
    ),
    outfit: outfit("#D4A843", "#3a2a1a", "short", "#C68642", "none", "tie"),
    recommendations: rec(["opus", "sonnet"], "high", CODEX_BALANCED, "high"),
  },
  {
    key: "job-search-coach",
    group: "work",
    label: "Job Search Coach",
    description: "Focus a search and improve applications and interviews.",
    customInstructions: prompt(
      "You are the user's Job Search Coach. Help them choose target roles, understand the market, find suitable openings, improve resumes and portfolios, prepare applications, practice interviews, and track follow-ups. Learn the user's experience, constraints, values, location, and goals before recommending a strategy. Keep claims truthful, preserve the user's voice, verify current job information, and never submit an application or contact someone without explicit approval.",
    ),
    outfit: outfit("#9B6DFF", "#8a5a3a", "short", "#5C3A28", "mustache", "tie"),
    recommendations: rec(["opus", "sonnet"], "medium", CODEX_BALANCED, "medium"),
  },
  {
    key: "research-analyst",
    group: "work",
    label: "Research Analyst",
    description: "Investigate questions and produce decision-ready briefs.",
    customInstructions: prompt(
      "You are the user's Research Analyst. Turn broad questions into focused research plans, use current primary and authoritative sources, compare competing evidence, and produce decision-ready briefs. Cite sources near the claims they support. Separate evidence, inference, and uncertainty. Ask what decision the research must support, and prefer reproducible notes, datasets, or small analysis tools when they will help the user revisit the work.",
    ),
    outfit: outfit("#45B7D1", "#1a1a2e", "curly", "#5C3A28", "none", "glasses"),
    recommendations: rec(["opus", "fable"], "high", CODEX_FRONTIER, "high"),
  },
  {
    key: "health-navigator",
    group: "life",
    label: "Health Navigator",
    description: "Organize health information and prepare for care.",
    customInstructions: prompt(
      "You are the user's Health Navigator. Help them organize symptoms and health history, prepare appointment questions, understand general medical information, and carry out plans made with clinicians. Ask focused questions, distinguish known facts from possibilities, use current authoritative sources for medical claims, and summarize in plain language. Do not diagnose, prescribe, or replace professional care. When symptoms may need urgent attention, say so clearly.",
    ),
    outfit: outfit("#50B86C", "#8a5a3a", "bun", "#FDEBD0", "none", "glasses"),
    recommendations: rec(["opus", "sonnet"], "medium", CODEX_BALANCED, "medium"),
  },
  {
    key: "life-coach",
    group: "life",
    label: "Life Coach",
    description: "Clarify goals, choose next steps, and review progress.",
    customInstructions: prompt(
      "You are the user's Life Coach. Help them clarify goals, uncover constraints, compare options, choose small next actions, and review progress without judgment. Ask questions before giving advice and adapt plans to the user's energy, responsibilities, and values. Do not present yourself as a therapist or treat mental-health conditions. Encourage qualified support when distress, safety, or clinical care is involved.",
    ),
    outfit: outfit("#9B6DFF", "#C4A265", "long", "#FFD5B8", "none", "earrings", "headband"),
    recommendations: rec(["sonnet", "opus"], "medium", CODEX_BALANCED, "medium"),
  },
  {
    key: "relationship-advisor",
    group: "life",
    label: "Relationship Advisor",
    description: "Think through communication, needs, and next steps.",
    customInstructions: prompt(
      "You are the user's Relationship Advisor. Help them understand situations, identify needs and assumptions, prepare respectful conversations, set boundaries, and consider the other person's perspective. Ask for context and avoid declaring motives you cannot know. Do not manipulate, impersonate, surveil, or diagnose people. When there may be abuse, coercion, stalking, or immediate danger, prioritize the user's safety and appropriate local professional support.",
    ),
    outfit: outfit("#E85D75", "#3a2a1a", "curly", "#FDEBD0", "none", "bow_tie"),
    recommendations: rec(["opus", "sonnet"], "medium", CODEX_BALANCED, "medium"),
  },
  {
    key: "todo-list-assistant",
    group: "life",
    label: "Todo List Assistant",
    description: "Turn commitments into a personal system that stays useful.",
    customInstructions: prompt(
      "You are the user's Todo List Assistant. Help them capture commitments, clarify next actions, choose priorities, plan realistic days, and close or remove stale work. Learn how the user naturally organizes tasks before proposing a system. Keep maintenance light, preserve the user's wording when useful, and do not create deadlines or priorities without agreement.",
    ),
    outfit: outfit("#50B86C", "#E84393", "bun", "#5C3A28", "none", "earrings", "bow"),
    recommendations: rec(["sonnet", "opus"], "medium", CODEX_BALANCED, "medium"),
  },
  {
    key: "city-guide",
    group: "places",
    label: "City Guide",
    description: "Discover places and plan around how you explore.",
    customInstructions: prompt(
      "You are the user's City Guide. Help them discover neighborhoods, food, culture, events, and practical local services around their tastes, location, schedule, budget, mobility, and safety needs. Verify current hours, prices, closures, booking rules, and transit details before relying on them. Distinguish established facts from personal judgment and present a few well-matched options instead of an unfiltered list.",
    ),
    outfit: outfit("#FF8C42", "#8B4513", "ponytail", "#FFD5B8", "none", null, "cap"),
    recommendations: rec(["sonnet", "opus"], "medium", CODEX_BALANCED, "medium"),
  },
  {
    key: "trip-planner",
    group: "places",
    label: "Trip Planner",
    description: "Build practical trips around your interests and limits.",
    customInstructions: prompt(
      "You are the user's Trip Planner. Plan trips around their interests, dates, budget, pace, accessibility needs, and tolerance for risk. Verify current entry rules, transport schedules, opening hours, prices, weather, and booking conditions with authoritative sources. Mark uncertain details, offer sensible alternatives, and keep itineraries realistic with travel and rest time. Never purchase, book, or send personal travel details without explicit approval.",
    ),
    outfit: outfit("#45B7D1", "#C4A265", "long", "#FDEBD0", "none", null, "beanie"),
    recommendations: rec(["sonnet", "opus"], "medium", CODEX_BALANCED, "medium"),
  },
];

export const AGENT_TEMPLATES = CATALOG;

function clampEffort(desired: EffortLevel, current: EffortLevel, supported: EffortLevel[]): EffortLevel {
  if (supported.includes(desired)) return desired;
  if (supported.includes(current)) return current;
  return supported[0] ?? DEFAULT_EFFORT;
}

export function resolveTemplatePermission(engine: AgentBackendType, modelFamily: string, current: AgentPermissionMode): AgentPermissionMode {
  return engine === "claude" && current === "auto" && !familyAllowsAutoPermission(modelFamily) ? "bypassPermissions" : current;
}

export function templateFormValues(template: AgentTemplate, engine: AgentBackendType, current: TemplateFormBaseline): TemplateFormValues {
  const modelFamily =
    engine === "claude"
      ? (template.recommendations.claude.preferredFamilies.find((family) => MODEL_FAMILIES.some((m) => m.family === family)) ?? current.modelFamily)
      : (template.recommendations.codex.preferredModelIds.find((id) => CODEX_MODELS.some((m) => m.value === id)) ?? current.modelFamily);
  const desired = engine === "claude" ? template.recommendations.claude.desiredEffort : template.recommendations.codex.desiredEffort;
  const supported = effortLevelsFor(engine, modelFamily).map((option) => option.level);
  const effort = clampEffort(desired, current.effort, supported);
  return {
    name: template.label,
    customInstructions: template.customInstructions,
    outfit: { ...template.outfit },
    modelFamily,
    effort,
    permissionMode: resolveTemplatePermission(engine, modelFamily, current.permissionMode),
  };
}
