import type { AgentBackendType, AgentInfo, AgentOutfit } from "../../shared/types.ts";
import { CODEX_MODELS, MODEL_FAMILIES } from "../../shared/types.ts";
import { agents } from "../agents/state.ts";
import { spawn } from "../agents/lifecycle.ts";
import { getUserByName } from "../users.ts";
import { DEFAULT_OPENCODE_MODEL } from "../backends/opencode/index.ts";

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

const OPENCODE_WELCOME_OUTFIT: AgentOutfit = {
  hat: "beanie",
  color: "#59C9A5",
  hair: "#2D3436",
  hairStyle: "short",
  skin: "#F4C7A1",
  beard: "none",
  accessory: "headphones",
};

const WELCOME_AGENTS: ReadonlyArray<{
  agentType: AgentBackendType;
  name: string;
  family: string;
}> = [
  { agentType: "claude", name: "Claude Welcome Agent", family: "Claude" },
  { agentType: "codex", name: "Codex Welcome Agent", family: "Codex" },
  { agentType: "opencode", name: "Free Welcome Agent", family: "OpenCode" },
];

function welcomeAgentPrompt(agentType: AgentBackendType): string {
  const self = WELCOME_AGENTS.find((agent) => agent.agentType === agentType)!;
  const roster = WELCOME_AGENTS.map((agent) => `${agent.name} (${agent.family})`).join(", ");
  return `You are the ${self.name} in this user's new Bureau office. Bureau is a persistent office of AI agents reachable from any device; each agent lives at a desk in a room with its own chat. New offices come preset with these welcome agents: ${roster}. The Free Welcome Agent runs on a free OpenCode model, so it can answer before the user signs in to Claude or Codex. If the user messages you without a specific request, welcome them to the office and suggest \`/help\` to see your available commands, skills, and tips. You can also offer to walk them through spawning their first agent or to showcase agent-to-agent communication. If they ask for the showcase, check the office agent manifest (curl -s localhost:${PORT}/api/agents -H "Authorization: Bearer $BUREAU_AGENT_TOKEN") to confirm the other welcome agents are present and then send each one a message asking for a message back. Be brief, friendly, and focus on what the user asks. For deeper Bureau questions, use https://github.com/smeltery/bureau/blob/master/README.md as a reference.`;
}

async function spawnWelcomeAgent(
  name: string,
  agentType: AgentBackendType,
  modelFamily: string,
  permissionMode: AgentInfo["permissionMode"],
  outfit: AgentOutfit,
  userId: string | null,
): Promise<void> {
  try {
    const created = await spawn(name, "~", permissionMode, undefined, welcomeAgentPrompt(agentType), undefined, outfit, modelFamily, agentType, undefined, undefined, userId);
    if (!created) {
      console.warn(`[bootstrap] ${name} spawn returned null (duplicate name or full room?)`);
    }
  } catch (err) {
    console.warn(`[bootstrap] ${name} spawn threw:`, err);
  }
}

/** Seed one welcome agent per backend on the first owner of a fresh office. */
export async function seedWelcomeAgents(username: string): Promise<void> {
  if (agents.size > 0) return;
  const userId = getUserByName(username)?.id ?? null;
  await spawnWelcomeAgent("Claude Welcome Agent", "claude", MODEL_FAMILIES[0].family, "auto", CLAUDE_WELCOME_OUTFIT, userId);
  await spawnWelcomeAgent("Codex Welcome Agent", "codex", CODEX_MODELS[0].value, "never", CODEX_WELCOME_OUTFIT, userId);
  await spawnWelcomeAgent("Free Welcome Agent", "opencode", DEFAULT_OPENCODE_MODEL, "bypassPermissions", OPENCODE_WELCOME_OUTFIT, userId);
}
