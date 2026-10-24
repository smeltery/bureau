import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { OfficeCookiePolicy, isOfficeSessionCookie, SHARED_COOKIE_NAME, SHARED_HOST_COOKIE_NAME } from "./policy.ts";

const office = new OfficeCookiePolicy("123456abcdef");
const other = new OfficeCookiePolicy("fedcba654321");
const request = (cookie: string) => new Request("https://office.test/", { headers: { cookie } });
const session = (raw: string) => ({ sessionIdHash: createHash("sha256").update(raw).digest("hex"), absoluteExpiresAt: Date.now() + 60_000 });

test("offices on one hostname select only their own cookies", () => {
  const req = request(`${office.names.host}=first; ${other.names.host}=second; ${SHARED_COOKIE_NAME}=old`);
  expect(office.read(req, true).selected).toBe("first");
  expect(other.read(req, true).selected).toBe("second");
  expect(office.read(request(`${other.names.host}=second`), true).selected).toBeNull();
  for (const secure of [true, false]) {
    const line = office.set("first", session("first").absoluteExpiresAt, secure);
    expect(line).toStartWith(`${office.writeName(secure)}=first;`);
    expect(line).toContain("Path=/; HttpOnly; SameSite=Lax;");
    expect(line.includes("Secure")).toBe(secure);
    expect(line).not.toContain("Domain=");
  }
});

test("current transport name takes precedence by presence, even when empty or invalid", () => {
  for (const secure of [true, false]) {
    const preferred = office.writeName(secure);
    const alternate = office.writeName(!secure);
    for (const value of ["", "invalid"]) {
      for (const cookie of [`${preferred}=${value}; ${alternate}=valid; ${SHARED_COOKIE_NAME}=old`, `${SHARED_COOKIE_NAME}=old; ${alternate}=valid; ${preferred}=${value}`]) {
        expect(office.read(request(cookie), secure).selected).toBe(value);
      }
    }
    expect(office.read(request(`${preferred}=first; ${preferred}=second`), secure).selected).toBe("first");
    expect(office.read(request(`${alternate}=alternate`), secure).selected).toBe("alternate");
  }
  expect(office.read(request(`${SHARED_HOST_COOKIE_NAME}=; ${SHARED_COOKIE_NAME}=old`), true).selected).toBe("");
});

test("legacy migration copies first, then retires matching copies only", () => {
  for (const secure of [true, false]) {
    for (const legacy of [SHARED_COOKIE_NAME, SHARED_HOST_COOKIE_NAME]) {
      const old = office.read(request(`${legacy}=old`), secure);
      const lines = office.migrate(old, session("old"), secure);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toStartWith(`${office.writeName(secure)}=old;`);
      expect(lines[0]).toMatch(/Max-Age=(59|60)/);
      expect(lines[0]).not.toContain("Max-Age=0");
      const confirmed = office.read(request(`${office.writeName(secure)}=old; ${legacy}=old; ${other.names.plain}=other`), secure);
      expect(office.migrate(confirmed, session("old"), secure)).toEqual([expect.stringContaining(`${legacy}=;`)]);
      expect(office.migrate(old, session("unrelated-bearer"), secure)).toEqual([]);
      expect(office.migrate(office.read(request(`${office.writeName(secure)}=old; ${legacy}=different`), secure), session("old"), secure)).toEqual([]);
    }
  }
});

test("logout preserves other offices and unrelated shared sessions", () => {
  const cookies = office.read(request(`${office.names.host}=own; ${SHARED_COOKIE_NAME}=other; ${SHARED_HOST_COOKIE_NAME}=own; ${other.names.host}=other`), true);
  const lines = office.clear(true, cookies, "own");
  expect(lines).toHaveLength(3);
  expect(lines.some((line) => line.startsWith(`${SHARED_COOKIE_NAME}=`))).toBe(false);
  expect(lines.some((line) => line.startsWith(`${other.names.host}=`))).toBe(false);
  expect(lines.every((line) => line.includes("Max-Age=0") && line.includes("Secure"))).toBe(true);
  expect(office.clear(false, cookies)).toHaveLength(2);
  expect(office.clear(false)[1]).toContain("Secure");
});

test("proxy filtering recognizes every office namespace without eating app cookies", () => {
  for (const name of [...Object.values(office.names), ...Object.values(other.names)]) expect(isOfficeSessionCookie(name)).toBe(true);
  for (const name of ["BUREAU_SESSION", "bureau_session_id", "bureau_session_123", "bureau_session_123456abcdef_extra"]) expect(isOfficeSessionCookie(name)).toBe(false);
});

test("an old HTTPS cookie from another office cannot shadow an HTTP legacy session", () => {
  const req = request(`${SHARED_HOST_COOKIE_NAME}=foreign; ${SHARED_COOKIE_NAME}=local`);
  expect(office.read(req, false, () => false).selected).toBe("local");
  expect(office.read(req, false, () => true).selected).toBe("foreign");
  expect(office.read(req, true, () => false).selected).toBe("foreign");
  const own = request(`${office.names.plain}=invalid; ${SHARED_HOST_COOKIE_NAME}=foreign; ${SHARED_COOKIE_NAME}=local`);
  expect(office.read(own, false, () => false).selected).toBe("invalid");
});
