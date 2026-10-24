import type { MembersChatMessage, MembersChatReactor } from "../../shared/members-chat.ts";

export type Line =
  | {
      op: "post";
      replyTo?: MembersChatMessage["replyTo"];
      id: string;
      kind?: MembersChatMessage["kind"];
      userId: string;
      userName: string;
      device?: string;
      timestamp: number;
      content: string;
    }
  | { op: "react"; id: string; timestamp: number; reactor: MembersChatReactor; active: boolean }
  | { op: "edit"; id: string; timestamp: number; content: string }
  | { op: "delete"; id: string; timestamp: number }
  | { op: "pin"; id: string; timestamp: number; active: boolean };

export interface FoldedMonth {
  order: string[];
  byId: Map<string, MembersChatMessage>;
}

export function applyChatRecord(folded: FoldedMonth, line: Line): void {
  if (line.op === "post") {
    if (folded.byId.has(line.id) || folded.order.includes(line.id)) return;
    folded.order.push(line.id);
    folded.byId.set(line.id, {
      id: line.id,
      kind: line.kind ?? "user",
      userId: line.userId,
      userName: line.userName,
      ...(line.device ? { device: line.device } : {}),
      timestamp: line.timestamp,
      content: line.content,
      ...(line.replyTo ? { replyTo: line.replyTo } : {}),
    });
  } else if (line.op === "pin") {
    const message = folded.byId.get(line.id);
    if (message) {
      const { pinnedAt: _previous, ...rest } = message;
      folded.byId.set(line.id, line.active ? { ...rest, pinnedAt: line.timestamp } : rest);
    }
  } else if (line.op === "edit") {
    const message = folded.byId.get(line.id);
    if (message) folded.byId.set(line.id, { ...message, content: line.content, editedAt: line.timestamp });
  } else if (line.op === "react") {
    const message = folded.byId.get(line.id);
    if (message) {
      const thumbsUp = (message.thumbsUp ?? []).filter((reactor) => reactor.userId !== line.reactor.userId);
      if (line.active) thumbsUp.push(line.reactor);
      folded.byId.set(line.id, { ...message, thumbsUp });
    }
  } else if (line.op === "delete") {
    folded.byId.delete(line.id);
  }
}
