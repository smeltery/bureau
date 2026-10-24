import { checkModelAvailability, type ModelCheckTarget } from "./check.ts";

export interface CapturedModelCheck extends ModelCheckTarget {
  current: () => boolean;
  apply: (missing: string | null) => void;
}

/** A run owns its captured configuration; a later edit cannot inherit its result. */
export function createModelAvailabilityRunner(capture: (agentId?: string) => CapturedModelCheck[], onError: () => void) {
  let running: Promise<void> | null = null;
  const pending = new Set<string>();
  let all = false;
  async function drain(): Promise<void> {
    while (all || pending.size) {
      const ids = all ? [undefined] : [...pending];
      all = false;
      pending.clear();
      const targets: CapturedModelCheck[] = [];
      for (const id of ids) {
        try {
          targets.push(...capture(id));
        } catch {
          onError();
        }
      }
      const results = await checkModelAvailability(targets);
      for (const target of targets) {
        const status = results.get(target.id);
        if (!status || status === "unknown") continue;
        try {
          if (target.current()) target.apply(status === "missing" ? target.model : null);
        } catch {
          onError();
        }
      }
    }
  }
  return function request(agentId?: string): Promise<void> {
    if (agentId === undefined) all = true;
    else pending.add(agentId);
    if (!running)
      running = drain().finally(() => {
        running = null;
        if (all || pending.size) return request(all ? undefined : pending.values().next().value);
      });
    return running;
  };
}
