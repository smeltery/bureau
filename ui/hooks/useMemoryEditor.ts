import { useEffect, useMemo, useState } from "react";
import { injectedMemorySize, type MemoryScope } from "../../shared/types.ts";

import { saveMemory, type MemorySaveResult as MemoryWriteResult } from "./memory/save.ts";

export type MemorySaveResult = { ok: true } | Extract<MemoryWriteResult, { ok: false }>;

export interface MemoryEditor {
  memory: string;
  setMemory: (value: string) => void;
  loaded: boolean;
  dirty: boolean;
  size: number;
  cap: number | null;
  save: () => Promise<MemorySaveResult>;
  reset: () => void;
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
  const [cap, setCap] = useState<number | null>(null);

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
    setCap(null);
    fetch(`/api/memory?${query}`, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw await parseError(res);
        return (await res.json()) as { text: string; version: string; cap: number };
      })
      .then((data) => {
        if (cancelled) return;
        setMemory(data.text);
        setBaseline(data.text);
        setVersion(data.version);
        setCap(data.cap);
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
    const result = await saveMemory({ scope, scopeId, text: memory, version });
    if (!result.ok) return result;
    setBaseline(memory);
    setVersion(result.version);
    return { ok: true };
  }

  return { memory, setMemory, loaded, dirty, size: injectedMemorySize(memory), cap, save, reset: () => setMemory(baseline) };
}
