import { useEffect, useState } from "react";
import type { AgentBackendType } from "../../../shared/types.ts";
import { mergeModelOptions, type ModelOption } from "./model-options.ts";

export function useModelOptions(agentType: AgentBackendType, cwd: string, fallback: ModelOption[], selected: string, context: { roomId?: string; agentId?: string; userId?: string } = {}) {
  const { roomId, agentId, userId } = context;
  const key = JSON.stringify([agentType, cwd, roomId, agentId, userId]);
  const [loaded, setLoaded] = useState<{ key: string; models: ModelOption[]; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // Debounce directory typing; never let an old environment's response
    // replace capabilities for a newer selection.
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ cwd });
      if (roomId) params.set("roomId", roomId);
      if (agentId) params.set("agentId", agentId);
      if (userId !== undefined) params.set("userId", userId);
      void fetch(`/api/backends/${agentType}/models?${params}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Model catalog unavailable");
          return response.json();
        })
        .then((body: { models?: Array<{ id: string; label: string; supportedEfforts?: ModelOption["supportedEfforts"]; supportsAutoPermission?: boolean }> }) => {
          if ("error" in body || !Array.isArray(body.models)) throw new Error("Model catalog unavailable");
          if (!controller.signal.aborted && Array.isArray(body.models)) setLoaded({ key, models: body.models.map(({ id, ...model }) => ({ ...model, family: id, catalogLabel: true })) });
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoaded({ key, models: [], error: "Live model details are unavailable. Showing built-in choices; the provider validates them when the agent runs." });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, agentType, cwd, roomId, agentId, userId]);
  return { modelOptions: mergeModelOptions(fallback, loaded?.key === key ? loaded.models : null, selected), modelCatalogError: loaded?.key === key ? loaded.error : undefined };
}
