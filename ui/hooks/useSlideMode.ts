import { useEffect, useState } from "react";
import { getSlideView, setSlideView } from "../device-settings.ts";
import { useAppState } from "../store.tsx";

export function useSlideMode(agentId: string): { enabled: boolean; active: boolean; setActive: (active: boolean) => void } {
  const { sessionContext, users } = useAppState();
  const self = sessionContext ? users.get(sessionContext.username.trim().toLocaleLowerCase()) : undefined;
  const enabled = self?.slideMode === true;
  const [active, setActiveState] = useState(() => getSlideView(agentId));

  useEffect(() => {
    setActiveState(getSlideView(agentId));
  }, [agentId]);

  useEffect(() => {
    if (!enabled) setActiveState(false);
  }, [enabled]);

  function setActive(next: boolean) {
    setSlideView(agentId, next);
    setActiveState(next);
  }

  return { enabled, active: enabled && active, setActive };
}
