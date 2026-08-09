// Slide Mode sidecar store.
//
// One JSON file per conversation, keyed by the turn's user_message entry id:
//   ~/.bureau/state/slides/<agentId>/<rootSessionId>.json
//   { "slides": { "<entryId>": SlideRecord, ... } }
//
// Deliberately NOT log entries: on-demand backfill arrives out of order and the
// log files stay pure chat. Keying by rootSessionId means edit-forks of the same
// conversation share a deck (orphaned keys from abandoned branches are harmless
// and can be pruned against the live log). Reads never throw - a missing or
// corrupt file yields an empty deck.
//
// Writes are synchronous read-modify-write via atomicWriteFileSync. Because JS
// is single-threaded and there is no await between the read and the write, two
// concurrent generations for the same conversation can't interleave and clobber
// each other's keys.
//
// The slides directory is an optional trailing argument on every function,
// defaulting to the real state root. Production callers pass nothing; tests pass
// a temp dir so nothing here can reach ~/.bureau (the injected-directory
// convention server/apps/registry.ts uses).

import { dirname, join } from "path";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { atomicWriteFileSync, BUREAU_DIR } from "../persistence/paths.ts";
import type { SlideDeck, SlideRecord } from "../../shared/slides.ts";

export const SLIDES_DIR = join(BUREAU_DIR, "state", "slides");

export type { SlideDeck };

function deckFilePath(agentId: string, rootSessionId: string, dir: string): string {
  return join(dir, agentId, `${rootSessionId}.json`);
}

// Read the whole slide map for a conversation. {} when absent or unreadable.
export function readDeck(agentId: string, rootSessionId: string, dir: string = SLIDES_DIR): SlideDeck {
  const path = deckFilePath(agentId, rootSessionId, dir);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { slides?: SlideDeck };
    return parsed.slides && typeof parsed.slides === "object" ? parsed.slides : {};
  } catch {
    return {};
  }
}

export function readSlide(agentId: string, rootSessionId: string, entryId: string, dir: string = SLIDES_DIR): SlideRecord | null {
  return readDeck(agentId, rootSessionId, dir)[entryId] ?? null;
}

// Insert / overwrite one slide (regeneration overwrites in place).
export function writeSlide(agentId: string, rootSessionId: string, entryId: string, record: SlideRecord, dir: string = SLIDES_DIR): void {
  const deck = readDeck(agentId, rootSessionId, dir);
  deck[entryId] = record;
  const path = deckFilePath(agentId, rootSessionId, dir);
  // The per-agent slides directory is created lazily here: atomicWriteFileSync
  // renames a sibling .tmp into place and does NOT create parents (only the
  // top-level state dirs are made at paths.ts module load). Recursive mkdir is a
  // no-op once it exists.
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFileSync(path, JSON.stringify({ slides: deck }, null, 2));
}

// NOTE: we deliberately do NOT prune the deck. A root deck is SHARED by every
// resumable fork branch under that root; keys the current leaf can't see may be
// live entries of a sibling/parent branch (reachable via /resume), not orphans.
// Pruning against one leaf's visible turns would erase another branch's slides,
// breaking "decks persist per conversation, forever". The design accepts the
// truly-abandoned keys as harmless; a correct sweep would need the union of all
// descendant leaves, which isn't worth the complexity.
