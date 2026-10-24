import { loadMemory } from "./memory/load.ts";
import type { SettingsFailure } from "./settings/feedback.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { injectedMemorySize, type MemoryScope } from "../../shared/types.ts";

import { saveMemory, type MemorySaveResult as MemoryWriteResult } from "./memory/save.ts";

export type MemorySaveResult = { ok: true } | Extract<MemoryWriteResult, { ok: false }>;

export interface MemoryEditor {
  memory: string;
  setMemory: (value: string) => void;
  loaded: boolean;
  dirty: boolean;
  loadError: SettingsFailure | null;
  retryLoad: () => void;
  size: number;
  cap: number | null;
  save: () => Promise<MemorySaveResult>;
  reset: () => void;
}

export function useMemoryEditor(scope: MemoryScope, scopeId: string | null, enabled = true): MemoryEditor {
  const [memory, setMemory] = useState("");
  const [baseline, setBaseline] = useState("");
  const [version, setVersion] = useState<string | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<SettingsFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const [cap, setCap] = useState<number | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ scope });
    if (scopeId != null) params.set("scopeId", scopeId);
    return params.toString();
  }, [scope, scopeId]);

  const loaded = enabled && loadedQuery === query;
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setLoadedQuery(null);
    setLoadError(null);
    setMemory("");
    setBaseline("");
    setVersion(null);
    setCap(null);
    if (enabled) {
      void loadMemory(`/api/memory?${query}`, controller.signal).then((result) => {
        if (controller.signal.aborted || generation.current !== current) return;
        if (!result.ok) {
          setLoadError(result.feedback);
          return;
        }
        setMemory(result.data.text);
        setBaseline(result.data.text);
        setVersion(result.data.version);
        setCap(result.data.cap);
        setLoadedQuery(query);
      });
    }
    return () => {
      ++generation.current;
      controller.abort();
    };
  }, [enabled, query, attempt]);

  const dirty = loaded && memory !== baseline;

  async function save(): Promise<MemorySaveResult> {
    if (!loaded || !dirty || version == null) return { ok: true };
    const current = generation.current;
    const result = await saveMemory({ scope, scopeId, text: memory, version });
    if (!result.ok) return result;
    if (generation.current !== current) return { ok: true };
    setBaseline(memory);
    setVersion(result.version);
    return { ok: true };
  }

  return {
    memory: loaded ? memory : "",
    setMemory: (value) => {
      if (loaded) setMemory(value);
    },
    loaded,
    dirty,
    loadError,
    retryLoad: () => {
      if (!loaded && loadError) {
        setLoadError(null);
        setAttempt((value) => value + 1);
      }
    },
    size: loaded ? injectedMemorySize(memory) : 0,
    cap: loaded ? cap : null,
    save,
    reset: () => setMemory(baseline),
  };
}
