// Shared harness for the Slide Mode generation tests. Drives createSlideMode
// through injected deps only: no agent manager, no filesystem, and zero LLM -
// the "backend" hands back a deferred the test resolves or rejects by hand, so
// every concurrency / stale-guard window is reachable deterministically.

import { createSlideMode, type SlideJobContext } from "../generate.ts";
import type { DeckTurn } from "../../../shared/slide-turns.ts";
import type { SlideRecord } from "../../../shared/slides.ts";

// A deferred we resolve by hand to hold a generation open.
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const flush = () => new Promise((r) => setTimeout(r, 0));

export function turn(overrides: Partial<DeckTurn> = {}): DeckTurn {
  return {
    entryId: "u1",
    promptText: "What is 2+2?",
    assistantText: "It is 4.",
    errorText: null,
    placeholder: false,
    ...overrides,
  };
}

export function job(overrides: Partial<SlideJobContext> = {}): SlideJobContext {
  return {
    agentType: "claude",
    modelFamily: "sonnet",
    cwd: "/tmp",
    rootSessionId: "root1",
    turn: turn(),
    prevSlideHtml: null,
    terminal: true,
    ...overrides,
  };
}

export interface Harness {
  ensureSlide: ReturnType<typeof createSlideMode>["ensureSlide"];
  onTurnSettled: ReturnType<typeof createSlideMode>["onTurnSettled"];
  deck: Map<string, SlideRecord>;
  ready: Array<{ entryId: string; slide: SlideRecord }>;
  failed: Array<{ entryId: string; reason: string }>;
  calls: string[]; // prompts passed to the backend, in order
  resolveNext: (html: string) => void;
  rejectNext: (message: string) => void;
  concurrentPeak: () => number;
  // null models an agent with NO current conversation (post-/clear), where
  // getRootSessionId returns null.
  setRoot: (root: string | null) => void;
  setJob: (entryId: string, job: SlideJobContext | null) => void;
  setTerminal: (entryId: string, terminal: boolean) => void;
}

export function harness(): Harness {
  const deck = new Map<string, SlideRecord>();
  const ready: Array<{ entryId: string; slide: SlideRecord }> = [];
  const failed: Array<{ entryId: string; reason: string }> = [];
  const calls: string[] = [];
  let currentRoot: string | null = "root1";
  let concurrent = 0;
  let peak = 0;
  const pending: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];
  const jobs = new Map<string, SlideJobContext | null>();
  // Per-turn terminal flag (default true - most tests deal with settled turns).
  const terminalById = new Map<string, boolean>();

  // Mirrors the production resolveSlideJob: no current conversation root ->
  // nothing to resolve.
  const defaultJob = (entryId: string): SlideJobContext | null =>
    currentRoot === null
      ? null
      : job({
          rootSessionId: currentRoot,
          turn: turn({ entryId }),
          terminal: terminalById.get(entryId) ?? true,
        });

  const slideMode = createSlideMode({
    resolveBackend: () => ({
      oneShotPrompt: (prompt: string) => {
        calls.push(prompt);
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        const d = deferred<string>();
        pending.push({
          resolve: (html: string) => {
            concurrent -= 1;
            d.resolve(html);
          },
          reject: (e: unknown) => {
            concurrent -= 1;
            d.reject(e);
          },
        });
        return d.promise;
      },
    }),
    resolveJob: (_agentId, entryId) => {
      if (jobs.has(entryId)) return jobs.get(entryId)!;
      const resolved = defaultJob(entryId);
      if (!resolved) return null;
      // A per-entry terminal override applies even to a preset job's turn.
      return { ...resolved, terminal: terminalById.get(entryId) ?? resolved.terminal };
    },
    // Same shape as the production guard: a rootless agent is never current.
    isCurrent: (_agentId, rootSessionId) => currentRoot !== null && currentRoot === rootSessionId,
    readSlide: (_a, _root, entryId) => deck.get(entryId) ?? null,
    writeSlide: (_a, _root, entryId, rec) => deck.set(entryId, rec),
    onSlideReady: (_a, _root, entryId, rec) => ready.push({ entryId, slide: rec }),
    onSlideFailed: (_a, _root, entryId, reason) => failed.push({ entryId, reason }),
    now: () => 1000,
  });

  return {
    ensureSlide: slideMode.ensureSlide,
    onTurnSettled: slideMode.onTurnSettled,
    deck,
    ready,
    failed,
    calls,
    resolveNext: (html) => pending.shift()?.resolve(html),
    rejectNext: (message) => pending.shift()?.reject(new Error(message)),
    concurrentPeak: () => peak,
    setRoot: (root) => {
      currentRoot = root;
    },
    setJob: (entryId, j) => jobs.set(entryId, j),
    setTerminal: (entryId, terminal) => terminalById.set(entryId, terminal),
  };
}
