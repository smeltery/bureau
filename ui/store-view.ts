const VIEW_KEY = "bureau:view";

export type SavedPanel = "tasks" | "cronjobs" | "plugins";

export interface SavedView {
  user: string;
  roomId: string | null;
  agentId: string | null;
  panel: SavedPanel | null;
}

export interface ViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): ViewStorage | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
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
  return value === "tasks" || value === "cronjobs" || value === "plugins" ? value : undefined;
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
  try {
    const view = parseSavedView(store.getItem(VIEW_KEY));
    if (!view || normalizeUser(view.user) !== normalizeUser(user)) return null;
    return view;
  } catch {
    return null;
  }
}

export function writeSavedView(user: string, view: Omit<SavedView, "user">, store: ViewStorage | null = storage()): void {
  if (!store) return;
  try {
    store.setItem(VIEW_KEY, JSON.stringify({ user: normalizeUser(user), ...view }));
  } catch {
    // View persistence is best-effort.
  }
}
