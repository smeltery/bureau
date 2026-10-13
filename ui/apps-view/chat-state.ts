import type { AppChatBoot } from "../../shared/integrations/app-chat.ts";

export function appChatDraftKey(boot: AppChatBoot, userId: string, agentId: string): string {
  return `bureau-app-draft:${JSON.stringify([boot.name, boot.hostGen, userId, agentId])}`;
}

export function beginAppSignIn(storage: Pick<Storage, "getItem" | "setItem">, boot: AppChatBoot, now = Date.now()): boolean {
  const key = `bureau-app-signin:${boot.name}:${boot.hostGen}`;
  try {
    const previous = Number(storage.getItem(key));
    if (previous > 0 && now - previous < 60_000) return false;
    storage.setItem(key, String(now));
    return true;
  } catch {
    return false;
  }
}

export function appSignInUrl(appUrl: string, query: string): string {
  const parameters = new URLSearchParams({ app: new URL(appUrl).hostname.split(".")[0]!, r: `/${query}`, widget: "1" });
  return `/auth/app?${parameters}`;
}

export function isAppSessionSignal(event: Pick<MessageEvent, "source" | "origin" | "data">, frame: Window | null, appUrl: string): boolean {
  return frame !== null && event.source === frame && event.origin === new URL(appUrl).origin && event.data === "bureau:app-session-required";
}
