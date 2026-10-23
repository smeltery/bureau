export interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
export function createInstallController(target: Pick<Window, "addEventListener" | "removeEventListener">) {
  let held: InstallPrompt | null = null;
  let installed = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const capture = (event: Event) => {
    event.preventDefault();
    held = event as InstallPrompt;
    notify();
  };
  const complete = () => {
    installed = true;
    held = null;
    notify();
  };
  target.addEventListener("beforeinstallprompt", capture);
  target.addEventListener("appinstalled", complete);
  return {
    snapshot: () => (installed ? ("installed" as const) : held ? ("ready" as const) : ("unavailable" as const)),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async install() {
      const prompt = held;
      if (!prompt || installed) return "unavailable" as const;
      held = null;
      notify();
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") complete();
      return outcome;
    },
    dispose() {
      target.removeEventListener("beforeinstallprompt", capture);
      target.removeEventListener("appinstalled", complete);
      listeners.clear();
    },
  };
}
export let installController: ReturnType<typeof createInstallController> | null = null;
export function captureInstallPrompt() {
  if (!installController && typeof window !== "undefined") installController = createInstallController(window);
}
export function isStandalone() {
  return typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
}
export function isAppleMobile() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
