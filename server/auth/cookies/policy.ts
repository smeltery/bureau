import { createHash } from "node:crypto";

export const SHARED_COOKIE_NAME = "bureau_session";
export const SHARED_HOST_COOKIE_NAME = "__Host-bureau_session";
export type CookieSlot = "host" | "plain" | "sharedHost" | "sharedPlain";
export interface SessionCookies {
  values: Record<CookieSlot, string | null>;
  selectedName: CookieSlot | null;
  selected: string | null;
}

export function isOfficeSessionCookie(name: string): boolean {
  return /^(?:__Host-)?bureau_session(?:_[a-f0-9]{12})?$/.test(name);
}

function cookieLine(name: string, value: string, maxAge: number, secure: boolean): string {
  return [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`, ...(secure ? ["Secure"] : [])].join("; ");
}

export class OfficeCookiePolicy {
  readonly names: Record<CookieSlot, string>;
  constructor(id: string) {
    if (!/^[a-f0-9]{12}$/.test(id)) throw new Error("Invalid office cookie namespace");
    this.names = { host: `__Host-bureau_session_${id}`, plain: `bureau_session_${id}`, sharedHost: SHARED_HOST_COOKIE_NAME, sharedPlain: SHARED_COOKIE_NAME };
  }

  writeName(isHttps: boolean): string {
    return this.names[isHttps ? "host" : "plain"];
  }

  read(request: Request, isHttps: boolean, validSharedHost?: (raw: string) => boolean): SessionCookies {
    const values: SessionCookies["values"] = { host: null, plain: null, sharedHost: null, sharedPlain: null };
    for (const part of (request.headers.get("cookie") ?? "").split(";")) {
      const separator = part.indexOf("=");
      if (separator <= 0) continue;
      const name = part.slice(0, separator).trim();
      const slot = (Object.keys(this.names) as CookieSlot[]).find((slot) => this.names[slot] === name);
      if (slot && values[slot] === null) values[slot] = part.slice(separator + 1).trim();
    }
    // Presence wins over validity, including empty values. Never rescue a bad
    // office cookie with a shared cookie or a cookie belonging to another office.
    const order: CookieSlot[] = isHttps ? ["host", "plain", "sharedHost", "sharedPlain"] : ["plain", "host", "sharedHost", "sharedPlain"];
    if (!isHttps && values.host === null && values.plain === null && values.sharedHost !== null && values.sharedPlain !== null && validSharedHost && !validSharedHost(values.sharedHost)) {
      return { values, selectedName: "sharedPlain", selected: values.sharedPlain };
    }
    const selectedName = order.find((slot) => values[slot] !== null) ?? null;
    return { values, selectedName, selected: selectedName === null ? null : values[selectedName] };
  }

  set(raw: string, absoluteExpiresAt: number, isHttps: boolean): string {
    return cookieLine(this.writeName(isHttps), raw, Math.max(0, Math.floor((absoluteExpiresAt - Date.now()) / 1000)), isHttps);
  }

  clear(isHttps: boolean, cookies?: SessionCookies, authenticatedRaw?: string | null): string[] {
    const slots: CookieSlot[] = ["plain", "host"];
    // Old shared names may still hold another office's session. Only clear
    // copies of the session this office actually authenticated and revoked.
    if (authenticatedRaw && cookies) {
      for (const slot of ["sharedHost", "sharedPlain"] as const) if (cookies.values[slot] === authenticatedRaw) slots.push(slot);
    }
    return slots.map((slot) => cookieLine(this.names[slot], "", 0, isHttps || slot === "host" || slot === "sharedHost"));
  }

  migrate(cookies: SessionCookies, session: { sessionIdHash: string; absoluteExpiresAt: number }, isHttps: boolean): string[] {
    const { selected, selectedName } = cookies;
    if (!selected || selectedName === null || createHash("sha256").update(selected).digest("hex") !== session.sessionIdHash) return [];
    const target: CookieSlot = isHttps ? "host" : "plain";
    if (selectedName !== target) return [this.set(selected, session.absoluteExpiresAt, isHttps)];
    return (Object.keys(this.names) as CookieSlot[])
      .filter((slot) => slot !== target && cookies.values[slot] === selected)
      .map((slot) => cookieLine(this.names[slot], "", 0, isHttps || slot === "host" || slot === "sharedHost"));
  }
}
