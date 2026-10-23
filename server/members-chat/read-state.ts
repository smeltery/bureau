import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "../persistence/paths.ts";
import type { MembersChatSummary } from "../../shared/members-chat.ts";

type Position = { month: string; index: number };
type Month = { order: string[]; byId: ReadonlyMap<string, unknown> };

export function createChatReadState(dir: string, history: { positionOf(id: string): Position | null; visitMonths(visit: (month: string, data: Month) => void): void }) {
  const path = join(dir, "reads.json");
  let pointers = new Map<string, string>();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid read positions");
    pointers = new Map(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[team-chat] Could not restore read positions:", error);
  }

  function summary(userId: string): MembersChatSummary {
    const readPointer = pointers.get(userId) ?? null;
    const position = readPointer ? history.positionOf(readPointer) : null;
    let unread = 0;
    let latestId: string | null = null;
    history.visitMonths((month, data) => {
      for (let index = 0; index < data.order.length; index++) {
        const id = data.order[index]!;
        if (!data.byId.has(id)) continue;
        latestId = id;
        if (!position || month > position.month || (month === position.month && index > position.index)) unread++;
      }
    });
    return { userId, readPointer, unread, latestId };
  }

  function markRead(userId: string, id: string): MembersChatSummary {
    const next = history.positionOf(id);
    const previousId = pointers.get(userId);
    const previous = previousId ? history.positionOf(previousId) : null;
    if (next && (!previous || next.month > previous.month || (next.month === previous.month && next.index > previous.index))) {
      const updated = new Map(pointers).set(userId, id);
      mkdirSync(dir, { recursive: true });
      atomicWriteFileSync(path, JSON.stringify(Object.fromEntries(updated)) + "\n");
      pointers = updated;
    }
    return summary(userId);
  }

  return { summary, markRead };
}
