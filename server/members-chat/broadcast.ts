import type { MembersChatSummary } from "../../shared/members-chat.ts";
import { browsers } from "../ws/broadcast.ts";
import { getWsUser } from "../users.ts";
import type { MembersChatStore } from "./store.ts";

/** Read positions are private to a member, shared across their browser tabs. */
export function broadcastChatSummary(store: MembersChatStore, userId?: string): void {
  const summaries = new Map<string, MembersChatSummary>();
  for (const ws of browsers) {
    const user = getWsUser(ws);
    if (!user || (userId !== undefined && user.id !== userId)) continue;
    let summary = summaries.get(user.id);
    if (!summary) {
      summary = store.summary(user.id);
      summaries.set(user.id, summary);
    }
    ws.send(JSON.stringify({ type: "members_chat_summary", summary }));
  }
}
