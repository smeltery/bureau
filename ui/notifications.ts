// Desktop/browser notifications + tab-attention cues (title flash, favicon
// badge) for when an agent finishes work while the tab is backgrounded. The
// in-app sound (ui/store.tsx) and the per-room gating (shared/notifications.ts)
// decide *whether* to alert; this module is the *how* for an unfocused tab.

export type NotifPermission = NotificationPermission | "unsupported";

export function notificationPermission(): NotifPermission {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

// Must be called from a user gesture (button click) — browsers reject
// requestPermission() outside one. Resolves to the resulting permission, or
// "unsupported" where the Notification API is absent (older iOS Safari, etc).
export async function requestNotificationPermission(): Promise<NotifPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

// Fire a desktop notification. No-op unless permission is granted and the tab
// is actually hidden — a focused tab already shows the conversation, so a
// system toast would just be noise. `tag` collapses repeated alerts for the
// same agent into one. onClick refocuses the window and runs the callback.
export function showDesktopNotification(opts: { title: string; body?: string; tag?: string; onClick?: () => void }): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && !document.hidden) return;
  try {
    const n = new Notification(opts.title, { body: opts.body, tag: opts.tag, icon: faviconHref() ?? undefined });
    n.onclick = () => {
      try {
        window.focus();
      } catch {}
      opts.onClick?.();
      n.close();
    };
  } catch {}
}

// ---------------------------------------------------------------------------
// Tab-attention cues: a "●" prefix on the title plus a red dot on the favicon,
// both cleared automatically the moment the tab becomes visible again.

let baseTitle: string | null = null;
let baseFavicon: string | null = null;
let attentionActive = false;
let listenerInstalled = false;

function faviconLink(): HTMLLinkElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLLinkElement>("link[rel='icon']");
}

function faviconHref(): string | null {
  return faviconLink()?.href ?? null;
}

function installVisibilityClear() {
  if (listenerInstalled || typeof document === "undefined") return;
  listenerInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) clearAttention();
  });
  window.addEventListener("focus", () => clearAttention());
}

export function markAttention(): void {
  if (typeof document === "undefined" || attentionActive) return;
  installVisibilityClear();
  attentionActive = true;
  if (baseTitle === null) baseTitle = document.title;
  document.title = `● ${baseTitle}`;
  const link = faviconLink();
  if (link) {
    if (baseFavicon === null) baseFavicon = link.getAttribute("href");
    const href = baseFavicon ?? "";
    // The favicon is an inline SVG data URI; splice a red badge circle in
    // before the closing tag. %23 is an escaped '#' since this lives in a URL.
    if (href.includes("</svg>")) {
      link.setAttribute("href", href.replace("</svg>", "<circle cx='27' cy='5' r='5' fill='%23ff4d4d'/></svg>"));
    }
  }
}

export function clearAttention(): void {
  if (!attentionActive) return;
  attentionActive = false;
  if (typeof document === "undefined") return;
  if (baseTitle !== null) document.title = baseTitle;
  const link = faviconLink();
  if (link && baseFavicon !== null) link.setAttribute("href", baseFavicon);
}
