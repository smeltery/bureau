import { hashOf } from "./tokens.ts";
import type { SessionCookies } from "./http-env.ts";
import type { SessionLookup } from "./session-validation.ts";

export type BrowserSessionDiagnostic =
  | { outcome: "cookie_absent"; gate: "http" | "ws" }
  | { outcome: "legacy_selected"; gate: "http" | "ws" }
  | {
      outcome: "cookie_rejected";
      gate: "http" | "ws";
      selected: "host" | "legacy";
      legacyAlsoPresent: boolean;
      marker?: string;
    }
  | {
      outcome: "session_matched";
      gate: "ws";
      selected: "host" | "legacy";
      sessionPrefix: string;
    };

export function browserSessionDiagnostic(cookies: SessionCookies, lookup: SessionLookup | null, gate: "http" | "ws"): BrowserSessionDiagnostic | null {
  if (cookies.hostRaw === null && cookies.legacyRaw === null) {
    return { outcome: "cookie_absent", gate };
  }
  const selected = cookies.hostRaw !== null ? "host" : "legacy";
  if (!lookup) {
    return {
      outcome: "cookie_rejected",
      gate,
      selected,
      legacyAlsoPresent: cookies.legacyRaw !== null,
      marker: cookies.selected ? hashOf(cookies.selected).slice(0, 6) : undefined,
    };
  }
  if (gate === "http") {
    return selected === "legacy" ? { outcome: "legacy_selected", gate } : null;
  }
  return {
    outcome: "session_matched",
    gate,
    selected,
    sessionPrefix: lookup.sessionPrefix,
  };
}

const BROWSER_DIAGNOSTIC_WINDOW_MS = 60_000;
const BROWSER_DIAGNOSTIC_KEY_LIMIT = 256;
let browserDiagnosticWindowStartedAt = 0;
const browserDiagnosticKeys = new Set<string>();
let browserDiagnosticCapReported = false;

function browserFamily(userAgent: string | null): string {
  if (!userAgent) return "Unknown/Unknown";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Other";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /(?:iPhone|iPad|iPod)/.test(userAgent)
      ? "iOS"
      : /Android/.test(userAgent)
        ? "Android"
        : /Macintosh|Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "Other";
  return `${browser}/${os}`;
}

export function formatBrowserSessionDiagnostic(diagnostic: BrowserSessionDiagnostic, req: Request): string {
  const rawPath = new URL(req.url).pathname;
  const path = (rawPath.startsWith("/i/") ? "/i/<redacted>" : rawPath).slice(0, 120);
  const context = `gate=${diagnostic.gate} path=${path} client=${browserFamily(req.headers.get("user-agent"))}`;
  switch (diagnostic.outcome) {
    case "cookie_absent":
      return `[auth] browser session cookie absent ${context}`;
    case "legacy_selected":
      return `[auth] browser session selected legacy cookie ${context}`;
    case "cookie_rejected": {
      const selection = diagnostic.selected === "host" && diagnostic.legacyAlsoPresent ? "selected=__Host legacy_overridden=yes" : `selected=${diagnostic.selected === "host" ? "__Host" : "legacy"}`;
      const detail = diagnostic.marker ? `${selection} marker=${diagnostic.marker}` : selection;
      return `[auth] browser session cookie rejected as invalid or stale ${detail} ${context}`;
    }
    case "session_matched":
      return `[auth] browser session matched ${diagnostic.sessionPrefix}... selected=${diagnostic.selected === "host" ? "__Host" : "legacy"} ${context}`;
  }
}

export function emitBrowserSessionDiagnostic(diagnostic: BrowserSessionDiagnostic | null, req: Request, now = Date.now()): void {
  if (!diagnostic) return;
  const line = formatBrowserSessionDiagnostic(diagnostic, req);
  if (now - browserDiagnosticWindowStartedAt >= BROWSER_DIAGNOSTIC_WINDOW_MS) {
    browserDiagnosticWindowStartedAt = now;
    browserDiagnosticKeys.clear();
    browserDiagnosticCapReported = false;
  }
  if (browserDiagnosticKeys.has(line)) return;
  if (browserDiagnosticKeys.size >= BROWSER_DIAGNOSTIC_KEY_LIMIT) {
    if (!browserDiagnosticCapReported) {
      browserDiagnosticCapReported = true;
      console.log("[auth] browser session diagnostics capped for this window");
    }
    return;
  }
  browserDiagnosticKeys.add(line);
  console.log(line);
}

export function _testResetBrowserSessionDiagnostics(): void {
  browserDiagnosticWindowStartedAt = 0;
  browserDiagnosticKeys.clear();
  browserDiagnosticCapReported = false;
}
