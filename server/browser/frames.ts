import type { Frame, Locator } from "playwright-core";
import { MAX_FRAME_DEPTH } from "./params.ts";

const MAX_READ_FRAMES = 64;

// Frame paths describe the current frame tree, not a stable frame identity.
export function resolveBrowserFrame(root: Frame, path: number[]): Frame {
  let frame = root;
  for (const index of path) {
    const child = frame.childFrames()[index];
    if (!child || child.isDetached()) {
      throw new Error("framePath is no longer available; read snapshot again");
    }
    frame = child;
  }
  return frame;
}

export async function readBrowserSnapshot(root: Frame, limit: number, timeout: number, scope?: { selector?: string; framePath?: number[] }): Promise<string> {
  const entries: Array<{ frame: Frame; path: number[] }> = [];
  let omitted = false;

  const collect = (frame: Frame, path: number[]) => {
    if (entries.length >= MAX_READ_FRAMES || path.length > MAX_FRAME_DEPTH) {
      omitted = true;
      return;
    }
    entries.push({ frame, path });
    frame.childFrames().forEach((child, index) => collect(child, [...path, index]));
  };
  const scoped = scope?.selector !== undefined || scope?.framePath !== undefined;
  if (scoped) {
    entries.push({
      frame: resolveBrowserFrame(root, scope.framePath ?? []),
      path: [],
    });
  } else collect(root, []);

  const deadline = Date.now() + timeout;
  let output = "";
  const append = (part: string) => {
    const combined = output + part;
    const marker = "\n[truncated]";
    output = combined.length <= limit ? combined : combined.slice(0, Math.max(0, limit - marker.length)) + marker.slice(0, limit);
  };

  for (const { frame, path } of entries) {
    if (output.length >= limit) break;
    if (path.length) append(`\n\n--- Frame framePath=${JSON.stringify(path)} ---\n`);
    if (output.length >= limit) break;
    try {
      if (frame.isDetached()) throw new Error("Detached frame");
      const remaining = Math.max(1, deadline - Date.now());
      const body = frame.locator(scope?.selector ?? "body");
      const readTimeout = path.length ? Math.min(1500, remaining) : remaining;
      append(await snapshotWithEditableText(frame, body, readTimeout, limit - output.length));
    } catch (error) {
      if (!path.length) throw error;
      append("[frame unavailable]");
    }
  }
  if (omitted) append("\n[additional frames omitted]");
  return output;
}

export async function readBrowserText(root: Frame, limit: number, timeout: number, scope?: { selector?: string; framePath?: number[] }): Promise<string> {
  const frame = resolveBrowserFrame(root, scope?.framePath ?? []);
  return frame
    .locator(scope?.selector ?? "body")
    .innerText({ timeout })
    .then((text) => (text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated at ${limit} characters]`));
}

// Playwright omits contenteditable textbox children from the ARIA tree. Add
// only rendered values from visible, accessibility-present textboxes in scope.
async function snapshotWithEditableText(frame: Frame, scope: Locator, timeout: number, limit: number): Promise<string> {
  const deadline = Date.now() + timeout;
  const snapshot = await scope.ariaSnapshot({
    timeout: Math.max(1, deadline - Date.now()),
  });
  if (snapshot.length >= limit || Date.now() >= deadline) return snapshot;
  const boxes = scope.locator(":scope, :scope *").and(frame.getByRole("textbox")).and(frame.locator(":read-write:not(input):not(textarea)")).filter({ visible: true });
  const values: string[] = [];
  let length = 0;
  const count = await boxes.count();
  for (let index = 0; index < count && length < limit; index++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const value = (await boxes.nth(index).innerText({ timeout: remaining })).trim();
    if (!value) continue;
    values.push(value.slice(0, limit));
    length += value.length;
  }
  const normalized = snapshot.replace(/\s+/g, " ");
  const missing = values.filter((value) => !normalized.includes(value.replace(/\s+/g, " ")) && !snapshot.includes(JSON.stringify(value)));
  return missing.length ? snapshot + "\n\n--- Editable textbox text ---\n" + missing.map((value) => "- " + JSON.stringify(value)).join("\n") : snapshot;
}
