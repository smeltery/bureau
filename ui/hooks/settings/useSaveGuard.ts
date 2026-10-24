import { useEffect, useRef, useState } from "react";
import { addRawListener, removeRawListener } from "../../ws.ts";

export function useSaveGuard() {
  const [saving, setSaving] = useState(false);
  const state = useRef({ mounted: true, pending: false, listener: null as ((data: string) => void) | null });

  function clearListener() {
    if (state.current.listener) removeRawListener(state.current.listener);
    state.current.listener = null;
  }

  useEffect(() => {
    state.current.mounted = true;
    return () => {
      state.current.mounted = false;
      state.current.pending = false;
      clearListener();
    };
  }, []);

  return {
    saving,
    pending: () => state.current.pending,
    active: () => state.current.mounted && state.current.pending,
    begin() {
      if (!state.current.mounted || state.current.pending) return false;
      state.current.pending = true;
      setSaving(true);
      return true;
    },
    finish() {
      clearListener();
      state.current.pending = false;
      if (state.current.mounted) setSaving(false);
    },
    listen(listener: (data: string) => void) {
      if (!state.current.mounted || !state.current.pending) return;
      clearListener();
      state.current.listener = listener;
      addRawListener(listener);
    },
  };
}
