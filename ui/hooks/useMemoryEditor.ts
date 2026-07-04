import { useEffect, useMemo, useState } from "react";
import type { MemoryScope } from "../../shared/types.ts";

export type MemorySaveResult = { ok: true } | { ok: false; conflict?: boolean; message: string };

export interface MemoryEditor {
  memory: string;
  setMemory: (value: string) => void;
  loaded: boolean;
  dirty: boolean;
  save: () => Promise<MemorySaveResult>;
}

type ErrorEnvelope = { error?: { code?: string; message?: string } };

async function parseError(res: Response): Promise<{ code: string; message: string }> {
  try {
    const data = (await res.json()) as ErrorEnvelope;
    return {
      code: data.error?.code ?? `http_${res.status}`,
      message: data.error?.message ?? res.statusText,
    };
  } catch {
    return { code: `http_${res.status}`, message: res.statusText };
  }
}

export function useMemoryEditor(scope: MemoryScope, scopeId: string | null, enabled = true): MemoryEditor {
  const [memory, setMemory] = useState("");
  const [baseline, setBaseline] = useState("");
  const [version, setVersion] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams({ scope });
    if (scopeId != null) params.set("scopeId", scopeId);
    return params.toString();
  }, [scope, scopeId]);

  useEffect(() => {
    if (!enabled) {
      setLoaded(false);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    setMemory("");
    setBaseline("");
    setVersion(null);
    fetch(`/api/memory?${query}`, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw await parseError(res);
        return (await res.json()) as { text: string; version: string };
      })
      .then((data) => {
        if (cancelled) return;
        setMemory(data.text);
        setBaseline(data.text);
        setVersion(data.version);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, query]);

  const dirty = loaded && memory !== baseline;

  async function save(): Promise<MemorySaveResult> {
    if (!loaded || !dirty || version == null) return { ok: true };
    const res = await fetch("/api/memory", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, scopeId, text: memory, version }),
    });
    if (!res.ok) {
      const err = await parseError(res);
      return {
        ok: false,
        conflict: err.code === "memory_conflict",
        message: err.code === "memory_conflict" ? "Memory changed since you opened this. Reopen the dialog to edit the latest version." : err.message,
      };
    }
    const data = (await res.json()) as { version: string };
    setBaseline(memory);
    setVersion(data.version);
    return { ok: true };
  }

  return { memory, setMemory, loaded, dirty, save };
}
