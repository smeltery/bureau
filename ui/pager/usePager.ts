import { useCallback, useEffect, useState } from "react";
import type { PagerEntry } from "../../shared/types.ts";
import { addRawListener, removeRawListener } from "../ws.ts";

const REFRESH_MS = 60_000;

// The server only says "pages changed"; each tab refetches its own
// projection, since which pages a member can see depends on their rooms.
export function usePager(enabled = true) {
  const [pages, setPages] = useState<PagerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/pager").catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setError(body.error || "Could not load pages");
      return;
    }
    setError(null);
    setPages(Array.isArray(body.pages) ? body.pages : []);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    const onMessage = (data: string) => {
      if (data.includes('"pager_changed"')) void reload();
    };
    addRawListener(onMessage);
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => {
      removeRawListener(onMessage);
      clearInterval(timer);
    };
  }, [enabled, reload]);

  return { pages, error, reload };
}

export function openPagesFor(pages: PagerEntry[], userId: string | undefined): number {
  return userId ? pages.filter((page) => page.state === "open" && page.targetUserId === userId).length : 0;
}
