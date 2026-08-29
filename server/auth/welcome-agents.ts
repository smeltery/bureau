import type { AgentOutfit } from "../../shared/types.ts";
import { CODEX_MODELS, MODEL_FAMILIES } from "../../shared/types.ts";
import { agents } from "../agents/state.ts";
import { spawn } from "../agents/lifecycle.ts";
import { getUserByName } from "../users.ts";

const PORT = process.env.PORT || "4000";

const CLAUDE_WELCOME_OUTFIT: AgentOutfit = {
  hat: "bow",
  color: "#45B7D1",
  hair: "#6C5CE7",
  hairStyle: "long",
  skin: "#FDEBD0",
  beard: "none",
  accessory: "glasses",
};

const CODEX_WELCOME_OUTFIT: AgentOutfit = {
  hat: "none",
  color: "#E85D75",
  hair: "#E84393",
  hairStyle: "ponytail",
  skin: "#FDEBD0",
  beard: "stubble",
  accessory: "tie",
};

function welcomeAgentPrompt(agentType: "claude" | "codex"): string {
  const selfName = agentType === "claude" ? "Claude Welcome Agent" : "Codex Welcome Agent";
  const selfFamily = agentType === "claude" ? "Claude" : "Codex";
  const otherName = agentType === "claude" ? "Codex Welcome Agent" : "Claude Welcome Agent";
  const otherFamily = agentType === "claude" ? "Codex" : "Claude";
  return `You are the ${selfName} in this user's new Bureau office. Bureau is a persistent office of AI agents reachable from any device; each agent lives at a desk in a room with its own chat. New offices come preset with two welcome agents - you (a ${selfFamily} agent) and "${otherName}" (a ${otherFamily} agent). If the user messages you without a specific request, welcome them to the office and suggest \`/help\` to see your available commands, skills, and tips. You can also offer to walk them through spawning their first agent or to showcase agent-to-agent communication. If they ask for the showcase, check the office agent manifest (curl -s localhost:${PORT}/api/agents -H "Authorization: Bearer $BUREAU_AGENT_TOKEN") to confirm the other welcome agent is present and then send them a message asking for a message back. Be brief, friendly, and focus on what the user asks. For deeper Bureau questions, use https://github.com/smeltery/bureau/blob/master/README.md as a reference.`;
}

async function spawnWelcomeAgent(name: string, agentType: "claude" | "codex", modelFamily: string, permissionMode: "auto" | "never", outfit: AgentOutfit, userId: string | null): Promise<void> {
  try {
    const created = await spawn(name, "~", permissionMode, undefined, welcomeAgentPrompt(agentType), undefined, outfit, modelFamily, agentType, undefined, undefined, userId);
    if (!created) {
      console.warn(`[bootstrap] ${name} spawn returned null (duplicate name or full room?)`);
    }
  } catch (err) {
    console.warn(`[bootstrap] ${name} spawn threw:`, err);
  }
}

/** Seed one Claude + one Codex welcome agent on the first owner of a fresh office. */
export async function seedWelcomeAgents(username: string): Promise<void> {
  if (agents.size > 0) return;
  const userId = getUserByName(username)?.id ?? null;
  await spawnWelcomeAgent("Claude Welcome Agent", "claude", MODEL_FAMILIES[0].family, "auto", CLAUDE_WELCOME_OUTFIT, userId);
  await spawnWelcomeAgent("Codex Welcome Agent", "codex", CODEX_MODELS[0].value, "never", CODEX_WELCOME_OUTFIT, userId);
}
