import { useEffect, useState } from "react";
import { getSlideModeEnabled, getSlideView, setSlideView, subscribeSlideModeEnabled } from "../device-settings.ts";

export function useSlideMode(agentId: string): { enabled: boolean; active: boolean; setActive: (active: boolean) => void } {
  const [enabled, setEnabled] = useState(getSlideModeEnabled);
  const [active, setActiveState] = useState(() => getSlideView(agentId));

  useEffect(() => subscribeSlideModeEnabled(() => setEnabled(getSlideModeEnabled())), []);

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
