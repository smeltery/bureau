// Office-wide humans-only chat helpers and types. The store lives under
// ~/.bureau/members-chat/ as monthly JSONL; see server/members-chat/store.ts.

export const MEMBERS_CHAT_MAX_CHARS = 4000;
export const MEMBERS_CHAT_DEFAULT_PAGE = 100;
export const MEMBERS_CHAT_MAX_PAGE = 200;
// Cap returned pins (not pins stored on disk). Extra slot lets the UI know
// there are more than twenty.
export const MEMBERS_CHAT_PIN_LIMIT = 21;

export interface MembersChatReply {
  id: string;
  userName: string;
  excerpt: string;
}

export interface MembersChatMessage {
  id: string; // "YYYYMM-xxxxxxxx" — month names the JSONL file
  kind: "user";
  userId: string;
  userName: string;
  device?: string;
  timestamp: number;
  content: string;
  editedAt?: number;
  replyTo?: MembersChatReply;
  pinnedAt?: number;
}

export function membersChatExcerpt(content: string): string {
  return Array.from(content.trim()).slice(0, 200).join("");
}

export function recentMembersChatPins(messages: Iterable<MembersChatMessage>): MembersChatMessage[] {
  return Array.from(messages)
    .filter((message) => message.pinnedAt !== undefined)
    .sort((a, b) => b.pinnedAt! - a.pinnedAt!)
    .slice(0, MEMBERS_CHAT_PIN_LIMIT);
}
