import type { AgentInfo } from "../shared/types.ts";
import type { Page } from "./routes.ts";

export function pageFromFlags(flags: {
  tasksOpen: boolean;
  cronjobsOpen: boolean;
  appsOpen: boolean;
  skillsOpen?: boolean;
  pluginsOpen: boolean;
  settingsOpen: boolean;
  teamChatOpen: boolean;
}): Page | null {
  if (flags.settingsOpen) return "settings";
  if (flags.tasksOpen) return "tasks";
  if (flags.cronjobsOpen) return "schedules";
  if (flags.appsOpen) return "apps";
  if (flags.skillsOpen) return "skills";
  if (flags.pluginsOpen) return "plugins";
  if (flags.teamChatOpen) return "team-chat";
  return null;
}

/** Cycle to the next/previous agent in the current room, matching Tab/Shift+Tab logic. */
export function cycleAgent(agents: AgentInfo[], drafts: Map<string, string>, currentRoom: number, focusedAgentId: string | null, direction: "next" | "prev"): string | null {
  const roomAgents = agents.filter((agent) => agent.room === currentRoom);
  const sorted = [...roomAgents].sort((a, b) => a.desk - b.desk);
  const nonIdle = sorted.filter((agent) => (agent.state !== "idle" && agent.state !== "stopped") || (drafts.get(agent.id) ?? "").length > 0);
  const pool = nonIdle.length > 0 ? nonIdle : sorted;
  if (pool.length === 0) return null;
  const idx = pool.findIndex((agent) => agent.id === focusedAgentId);
  if (idx !== -1 && pool.length <= 1) return null;
  const next = idx === -1 ? (direction === "prev" ? pool[pool.length - 1] : pool[0]) : direction === "prev" ? pool[(idx - 1 + pool.length) % pool.length] : pool[(idx + 1) % pool.length];
  return next.id;
}
