export interface FocusDebugEntry {
  t: number;
  type: string;
  target?: string;
  path?: string;
  active: string;
  activeMicro?: string;
  activeRaf?: string;
}

const ENABLE_KEY = "bureau-debug-focus";
const MAX_ENTRIES = 300;

export function focusDebugEnabled(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return storage?.getItem(ENABLE_KEY) === "1";
  } catch {
    return false;
  }
}

export function describeFocusTarget(target: unknown): string {
  if (target === null || target === undefined) return "null";
  if (typeof window !== "undefined" && target === window) return "window";
  if (typeof document !== "undefined" && target === document) return "document";
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    const ctor = (target as { constructor?: { name?: string } }).constructor?.name;
    return ctor ? `<${ctor}>` : typeof target;
  }
  const id = target.id ? `#${target.id}` : "";
  const cls = typeof target.className === "string" && target.className.trim() ? "." + target.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
  return `${target.tagName.toLowerCase()}${id}${cls}`.slice(0, 80);
}

export function initFocusDebug(): void {
  if (typeof window === "undefined" || typeof document === "undefined" || !focusDebugEnabled(window.localStorage)) return;

  const entries: FocusDebugEntry[] = [];
  const record = (type: string, event?: Event) => {
    const entry: FocusDebugEntry = {
      t: Math.round(performance.now() * 10) / 10,
      type,
      target: event ? describeFocusTarget(event.target) : undefined,
      path: event ? event.composedPath().slice(0, 4).map(describeFocusTarget).join(" < ") : undefined,
      active: describeFocusTarget(document.activeElement),
    };
    queueMicrotask(() => {
      entry.activeMicro = describeFocusTarget(document.activeElement);
    });
    requestAnimationFrame(() => {
      entry.activeRaf = describeFocusTarget(document.activeElement);
    });
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
  };

  for (const type of ["pointerdown", "mousedown", "click", "focusin", "focusout"]) {
    document.addEventListener(type, (event) => record(type, event), true);
  }
  window.addEventListener("focus", () => record("window-focus"));
  window.addEventListener("blur", () => record("window-blur"));
  document.addEventListener("visibilitychange", () => record(`visibility:${document.visibilityState}`));

  (window as unknown as { __bureauFocusDump: () => FocusDebugEntry[] }).__bureauFocusDump = () => {
    console.table(entries);
    return entries;
  };
  console.info("[bureau] focus debug tracer active; dump with window.__bureauFocusDump()");
}
