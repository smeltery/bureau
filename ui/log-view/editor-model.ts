import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";

export interface Tab {
  path: string;
  content: string;
  mtime: number;
  language: string;
  size: number;
  dirty: boolean;
  banner: null | { kind: "stale"; currentMtime: number } | { kind: "external"; mtime: number } | { kind: "deleted" } | { kind: "save_error"; message: string };
}

const TABS_KEY = (agentId: string) => `bureau:editor:tabs:${agentId}`;
const RECENT_KEY = (agentId: string) => `bureau:editor:recent:${agentId}`;
const MAX_RECENT_FILES = 12;

export function readTabs(agentId: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(TABS_KEY(agentId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((p): p is string => typeof p === "string");
  } catch {
    return [];
  }
}

export function writeTabs(agentId: string, paths: string[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TABS_KEY(agentId), JSON.stringify(paths.slice(0, 20)));
  } catch {}
}

export function readRecentFiles(agentId: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY(agentId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((p): p is string => typeof p === "string").slice(0, MAX_RECENT_FILES);
  } catch {
    return [];
  }
}

export function writeRecentFiles(agentId: string, paths: string[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RECENT_KEY(agentId), JSON.stringify(paths.slice(0, MAX_RECENT_FILES)));
  } catch {}
}

export function rememberRecentFile(agentId: string, path: string): string[] {
  const next = [path, ...readRecentFiles(agentId).filter((p) => p !== path)].slice(0, MAX_RECENT_FILES);
  writeRecentFiles(agentId, next);
  return next;
}

export function languageExtension(language: string) {
  switch (language) {
    case "javascript":
      return [javascript({ jsx: true, typescript: true })];
    case "json":
      return [json()];
    case "markdown":
      return [markdown()];
    case "css":
      return [css()];
    case "html":
      return [html()];
    case "python":
      return [python()];
    case "rust":
      return [rust()];
    case "go":
      return [go()];
    default:
      return [];
  }
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}
