import type { PromptSnapshot } from "../../shared/integrations/audit.ts";

type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : null;
}

/** Only known prompt fields are retained; environment and credential fields never enter history. */
export function changedPromptSnapshots(target: string, before: string | null, after: string): PromptSnapshot[] {
  if (!["office-config.json", "agents.json", "users.json"].includes(target)) return [];
  try {
    const old = before === null ? null : JSON.parse(before);
    const next = JSON.parse(after);
    const snapshots: PromptSnapshot[] = [];
    function capture(scope: PromptSnapshot["scope"], id: string, field: string, previous: RecordValue | null, current: RecordValue) {
      const value = current[field];
      const text = typeof value === "string" ? value : "";
      const previousText = typeof previous?.[field] === "string" ? previous[field] : "";
      if (text !== previousText) snapshots.push({ scope, id, text });
    }
    function records(value: unknown): RecordValue[] {
      return Array.isArray(value) ? value.map(object).filter((item): item is RecordValue => item !== null) : [];
    }
    if (target === "office-config.json") {
      const current = object(next);
      if (current) capture("office", "office", "prompt", object(old), current);
    } else if (target === "users.json") {
      const previous = records(old);
      for (const user of records(next)) {
        if (typeof user.id === "string") capture("member", user.id, "memberPrompt", previous.find((item) => item.id === user.id) ?? null, user);
      }
    } else {
      const previousRooms = records(old);
      const previousAgents = previousRooms.flatMap((room) => records(room.agents));
      for (const room of records(next)) {
        if (typeof room.id === "string") capture("room", room.id, "prompt", previousRooms.find((item) => item.id === room.id) ?? null, room);
        for (const agent of records(room.agents)) {
          if (typeof agent.id === "string") capture("agent", agent.id, "customInstructions", previousAgents.find((item) => item.id === agent.id) ?? null, agent);
        }
      }
    }
    return snapshots;
  } catch {
    return [];
  }
}
