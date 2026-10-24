export type ModelAvailability = "available" | "missing" | "unknown";

export interface ModelCheckTarget {
  id: string;
  model: string;
  /** Captured account, room environment and working directory. */
  scope: string;
  list: () => Promise<readonly { id: string }[]>;
}

/** Absence only proves removal when the same connected provider still lists models. */
export function modelAvailability(model: string, models: readonly { id: string }[] | null): ModelAvailability {
  if (models === null) return "unknown";
  if (models.some((entry) => entry.id === model)) return "available";
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return "unknown";
  const provider = model.slice(0, slash + 1);
  return models.some((entry) => entry.id.startsWith(provider)) ? "missing" : "unknown";
}

/** List each isolated environment once, sequentially, without letting a stalled one block the rest. */
export async function checkModelAvailability(targets: readonly ModelCheckTarget[], timeoutMs = 3 * 60_000): Promise<Map<string, ModelAvailability>> {
  const groups = new Map<string, ModelCheckTarget[]>();
  for (const target of targets) {
    const group = groups.get(target.scope);
    if (group) group.push(target);
    else groups.set(target.scope, [target]);
  }
  const results = new Map<string, ModelAvailability>();
  for (const group of groups.values()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let models: readonly { id: string }[] | null = null;
    try {
      models = await Promise.race([
        group[0].list(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Model availability lookup timed out")), timeoutMs);
        }),
      ]);
    } catch {
      // Unavailable credentials, an offline provider or a timeout cannot prove removal.
    } finally {
      clearTimeout(timer);
    }
    for (const target of group) results.set(target.id, modelAvailability(target.model, models));
  }
  return results;
}
