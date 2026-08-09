// The browser side of the Slide Mode routes. Plain fetch, like ui/apps-view/
// appsApi.ts: the deck reads its initial state over HTTP and receives everything
// generated afterwards on the slide_ready WS push.

import type { EnsureSlideRes, SlideDeckRes } from "../../../shared/slides.ts";

async function slidesFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

// The conversation's committed slides. An agent with no live session answers an
// empty deck (200), so there is no not-found case to branch on here.
export function fetchSlideDeck(agentId: string): Promise<SlideDeckRes> {
  return slidesFetch<SlideDeckRes>("GET", `/api/agents/${encodeURIComponent(agentId)}/slides`);
}

// Ask for one turn's slide. Answers `ready` from cache, else starts generation and
// answers `pending` - it never blocks on the model. `force` regenerates even a
// matching cache; `feedback` is a one-shot instruction for that regeneration.
export function ensureSlide(agentId: string, entryId: string, opts: { force?: boolean; feedback?: string } = {}): Promise<EnsureSlideRes> {
  return slidesFetch<EnsureSlideRes>("POST", `/api/agents/${encodeURIComponent(agentId)}/slides/${encodeURIComponent(entryId)}`, opts);
}
