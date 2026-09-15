// Monthly JSONL members-chat store. One office-wide stream for signed-in
// humans. A chat between people has no natural end, so history is cut by
// calendar month (`YYYY-MM.jsonl`). Ordering is FILE ORDER (append order),
// not wall-clock: a clock that moves backward cannot reorder history.
// Edits/deletes/pins append to the month that holds the target id — never
// rewrite an existing file.

import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { MEMBERS_CHAT_DEFAULT_PAGE, MEMBERS_CHAT_MAX_CHARS, MEMBERS_CHAT_MAX_PAGE, membersChatExcerpt, recentMembersChatPins, type MembersChatMessage } from "../../shared/members-chat.ts";

export { MEMBERS_CHAT_DEFAULT_PAGE, MEMBERS_CHAT_MAX_CHARS, MEMBERS_CHAT_MAX_PAGE };

const MONTH_FILE = /^(\d{4})-(\d{2})\.jsonl$/;
const ID_SHAPE = /^(\d{4})(\d{2})-[0-9a-f]{8}$/;

export type MembersChatErrorCode = "empty" | "too_long" | "reply_not_found";

export class MembersChatError extends Error {
  constructor(
    public readonly code: MembersChatErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MembersChatError";
  }
}

type Line =
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
  | { op: "delete"; id: string; timestamp: number }
  | { op: "pin"; id: string; timestamp: number; active: boolean };

interface FoldedMonth {
  order: string[];
  byId: Map<string, MembersChatMessage>;
}

export interface MembersChatPage {
  pinned: MembersChatMessage[];
  messages: MembersChatMessage[];
  hasMore: boolean;
}

export interface PostInput {
  replyTo?: string;
  userId: string;
  userName: string;
  device?: string;
  content: string;
}

export interface MembersChatStore {
  setPinned(id: string, active: boolean): MembersChatMessage | null;
  post(input: PostInput): MembersChatMessage;
  delete(id: string): MembersChatMessage | null;
  get(id: string): MembersChatMessage | null;
  page(opts?: { before?: string; limit?: number }): MembersChatPage;
}

export function monthKey(timestamp: number): string {
  const d = new Date(timestamp);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function monthOfId(id: string): string | null {
  const m = ID_SHAPE.exec(id);
  return m ? `${m[1]}-${m[2]}` : null;
}

function validateContent(content: string): string {
  if (typeof content !== "string") {
    throw new MembersChatError("empty", "text must be a string");
  }
  if (content.length > MEMBERS_CHAT_MAX_CHARS) {
    throw new MembersChatError("too_long", `text must be at most ${MEMBERS_CHAT_MAX_CHARS} characters`);
  }
  if (content.trim() === "") {
    throw new MembersChatError("empty", "a message needs text");
  }
  return content;
}

function randomHex8(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createMembersChatStore(dir: string, opts: { now?: () => number } = {}): MembersChatStore {
  const now = opts.now ?? (() => Date.now());
  const cache = new Map<string, FoldedMonth>();
  let pinIndex: Map<string, MembersChatMessage> | null = null;

  const monthFile = (month: string) => join(dir, `${month}.jsonl`);

  function listMonths(): string[] {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    return names
      .filter((n) => MONTH_FILE.test(n))
      .map((n) => n.slice(0, -".jsonl".length))
      .sort();
  }

  function fold(month: string): FoldedMonth {
    const cached = cache.get(month);
    if (cached) return cached;
    const folded: FoldedMonth = { order: [], byId: new Map() };
    let text = "";
    try {
      text = readFileSync(monthFile(month), "utf-8");
    } catch {
      cache.set(month, folded);
      return folded;
    }
    for (const raw of text.split("\n")) {
      if (!raw.trim()) continue;
      let line: Line;
      try {
        line = JSON.parse(raw) as Line;
      } catch {
        continue;
      }
      if (line.op === "post") {
        if (folded.byId.has(line.id) || folded.order.includes(line.id)) continue;
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
      } else if (line.op === "delete") {
        folded.byId.delete(line.id);
      }
    }
    cache.set(month, folded);
    return folded;
  }

  function append(month: string, line: Line): void {
    mkdirSync(dir, { recursive: true });
    appendFileSync(monthFile(month), JSON.stringify(line) + "\n");
    cache.delete(month);
    if (pinIndex && (line.op === "pin" || pinIndex.has(line.id))) {
      const message = get(line.id);
      if (message?.pinnedAt !== undefined) pinIndex.set(line.id, message);
      else pinIndex.delete(line.id);
    }
  }

  function pinnedMessages(): MembersChatMessage[] {
    if (!pinIndex) {
      const index = new Map<string, MembersChatMessage>();
      for (const month of listMonths()) {
        const wasCached = cache.has(month);
        for (const message of fold(month).byId.values()) {
          if (message.pinnedAt !== undefined) index.set(message.id, message);
        }
        if (!wasCached) cache.delete(month);
      }
      pinIndex = index;
    }
    return recentMembersChatPins(pinIndex.values());
  }

  function get(id: string): MembersChatMessage | null {
    const month = monthOfId(id);
    if (!month) return null;
    return fold(month).byId.get(id) ?? null;
  }

  function positionOf(id: string): { month: string; index: number } | null {
    const month = monthOfId(id);
    if (!month) return null;
    const index = fold(month).order.indexOf(id);
    return index === -1 ? null : { month, index };
  }

  function setPinned(id: string, active: boolean): MembersChatMessage | null {
    const existing = get(id);
    if (!existing) return null;
    if ((existing.pinnedAt !== undefined) === active) return existing;
    append(monthOfId(id)!, { op: "pin", id, timestamp: now(), active });
    return get(id);
  }

  function post(input: PostInput): MembersChatMessage {
    const content = validateContent(input.content);
    const target = input.replyTo === undefined ? null : get(input.replyTo);
    if (input.replyTo !== undefined && !target) {
      throw new MembersChatError("reply_not_found", "reply target not found");
    }
    const replyTo = target
      ? {
          id: target.id,
          userName: target.userName,
          excerpt: membersChatExcerpt(target.content),
        }
      : undefined;
    const timestamp = now();
    const month = monthKey(timestamp);
    const folded = fold(month);
    let id: string;
    do {
      id = `${month.replace("-", "")}-${randomHex8()}`;
    } while (folded.order.includes(id));
    const line: Line = {
      op: "post",
      ...(replyTo ? { replyTo } : {}),
      id,
      kind: "user",
      userId: input.userId,
      userName: input.userName,
      ...(input.device ? { device: input.device } : {}),
      timestamp,
      content,
    };
    append(month, line);
    return get(id)!;
  }

  function del(id: string): MembersChatMessage | null {
    const existing = get(id);
    if (!existing) return null;
    append(monthOfId(id)!, { op: "delete", id, timestamp: now() });
    return existing;
  }

  function page(opts: { before?: string; limit?: number } = {}): MembersChatPage {
    const limit = Math.max(1, Math.min(MEMBERS_CHAT_MAX_PAGE, opts.limit ?? MEMBERS_CHAT_DEFAULT_PAGE));
    const months = listMonths().reverse();
    const cursor = opts.before ? positionOf(opts.before) : null;
    const newestFirst: MembersChatMessage[] = [];
    let hasMore = false;
    for (const month of months) {
      if (cursor && month > cursor.month) continue;
      const folded = fold(month);
      let start = folded.order.length - 1;
      if (cursor && month === cursor.month) start = cursor.index - 1;
      for (let i = start; i >= 0; i--) {
        const m = folded.byId.get(folded.order[i]);
        if (!m) continue;
        if (newestFirst.length === limit) {
          hasMore = true;
          break;
        }
        newestFirst.push(m);
      }
      if (hasMore) break;
    }
    return {
      messages: newestFirst.reverse(),
      hasMore,
      pinned: pinnedMessages(),
    };
  }

  return {
    setPinned,
    post,
    delete: del,
    get,
    page,
  };
}
