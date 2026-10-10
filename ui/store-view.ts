import { getBrowserStorage, storageGetItem, storageSetItem, type BrowserStorage } from "./browser-storage.ts";

const VIEW_KEY = "bureau:view";

export type SavedPanel = "tasks" | "cronjobs" | "apps" | "skills" | "plugins" | "team-chat";

export interface SavedView {
  user: string;
  roomId: string | null;
  agentId: string | null;
  panel: SavedPanel | null;
}

export type ViewStorage = Pick<BrowserStorage, "getItem" | "setItem">;

function storage(): ViewStorage | null {
  return getBrowserStorage();
}

function normalizeUser(user: string): string {
  return user.trim().toLocaleLowerCase();
}

function readId(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readPanel(value: unknown): SavedPanel | null | undefined {
  if (value === null || value === undefined) return null;
  return value === "tasks" || value === "cronjobs" || value === "apps" || value === "skills" || value === "plugins" || value === "team-chat" ? value : undefined;
}

export function parseSavedView(raw: string | null): SavedView | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const user = typeof obj.user === "string" && obj.user.length > 0 ? obj.user : undefined;
    const roomId = readId(obj.roomId);
    const agentId = readId(obj.agentId);
    const panel = readPanel(obj.panel);
    if (user === undefined || roomId === undefined || agentId === undefined || panel === undefined) return null;
    return { user, roomId, agentId, panel };
  } catch {
    return null;
  }
}

export function readSavedView(user: string, store: ViewStorage | null = storage()): SavedView | null {
  if (!store) return null;
  const view = parseSavedView(storageGetItem(VIEW_KEY, store as BrowserStorage));
  if (!view || normalizeUser(view.user) !== normalizeUser(user)) return null;
  return view;
}

export function writeSavedView(user: string, view: Omit<SavedView, "user">, store: ViewStorage | null = storage()): void {
  if (!store) return;
  storageSetItem(VIEW_KEY, JSON.stringify({ user: normalizeUser(user), ...view }), store as BrowserStorage);
}
