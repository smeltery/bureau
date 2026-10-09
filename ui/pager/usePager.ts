import { useCallback, useEffect, useRef, useState } from "react";
import type { PagerEntry } from "../../shared/types.ts";
import { addRawListener, removeRawListener } from "../ws.ts";

const REFRESH_MS = 60_000;
interface PagerFilters {
  roomId?: string;
  includeResolved?: boolean;
  cursor?: string | null;
  linkedPageId?: string | null;
}
interface PagerResult {
  query: string;
  pages: PagerEntry[];
  nextCursor: string | null;
  error: string | null;
}

// Each refresh retains the selected history window; old responses cannot
// replace a newer room/cursor projection. The badge requests active pages only.
export function usePager(enabled = true, filters: PagerFilters = {}) {
  const params = new URLSearchParams({ includeResolved: String(filters.includeResolved ?? false), limit: "50" });
  if (filters.roomId) params.set("roomId", filters.roomId);
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.linkedPageId) params.set("page", filters.linkedPageId);
  const query = params.toString();
  const [result, setResult] = useState<PagerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const request = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    const generation = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const res = await fetch(`/api/pager?${query}`, { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load pages");
      if (generation === sequence.current)
        setResult({ query, pages: Array.isArray(body.pages) ? body.pages : [], nextCursor: typeof body.nextCursor === "string" ? body.nextCursor : null, error: null });
    } catch (error) {
      if (generation === sequence.current && !controller.signal.aborted)
        setResult((previous) => ({
          query,
          pages: previous?.query === query ? previous.pages : [],
          nextCursor: previous?.query === query ? previous.nextCursor : null,
          error: error instanceof Error ? error.message : "Could not load pages",
        }));
    } finally {
      if (generation === sequence.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    const onMessage = (data: string) => {
      if (data.includes('"pager_changed"')) void reload();
    };
    addRawListener(onMessage);
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => {
      sequence.current++;
      request.current?.abort();
      removeRawListener(onMessage);
      clearInterval(timer);
    };
  }, [enabled, reload]);

  const current = result?.query === query ? result : null;
  return { pages: current?.pages ?? [], error: current?.error ?? null, nextCursor: current?.nextCursor ?? null, loading: loading || (enabled && !current), reload };
}

export function openPagesFor(pages: PagerEntry[], userId: string | undefined): number {
  return userId ? pages.filter((page) => page.state === "open" && page.targetUserId === userId).length : 0;
}
