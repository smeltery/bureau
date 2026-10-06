import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUREAU_DIR } from "../persistence/paths.ts";
import { getUserById } from "../users.ts";

export interface BrowserDevice {
  id: string;
  userId: string;
  name: string;
  extensionOrigin: string;
  tokenHash: string;
  expiresAt: number;
}
export const DEVICES_FILE = join(BUREAU_DIR, "browser-sharing", "devices.json");
const codes = new Map<string, { userId: string; expiresAt: number }>();
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export function listDevices(): BrowserDevice[] {
  return existsSync(DEVICES_FILE) ? JSON.parse(readFileSync(DEVICES_FILE, "utf8")) : [];
}
function save(rows: BrowserDevice[]) {
  mkdirSync(join(BUREAU_DIR, "browser-sharing"), { recursive: true, mode: 0o700 });
  writeFileSync(DEVICES_FILE + ".tmp", JSON.stringify(rows), { mode: 0o600 });
  renameSync(DEVICES_FILE + ".tmp", DEVICES_FILE);
}
export function createPairingCode(userId: string, now = Date.now()): string {
  for (const [key, value] of codes) if (value.userId === userId || value.expiresAt <= now) codes.delete(key);
  if (codes.size >= 1000) throw new Error("pairing capacity reached");
  const code = randomBytes(24).toString("base64url");
  codes.set(digest(code), { userId, expiresAt: now + 5 * 60_000 });
  return code;
}
export function pairBrowser(code: string, name: string, extensionOrigin: string, now = Date.now()): { device: BrowserDevice; token: string } | null {
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(extensionOrigin)) return null;
  const key = digest(code);
  const pairing = codes.get(key);
  if (!pairing || pairing.expiresAt <= now || !getUserById(pairing.userId)) return null;
  const rows = listDevices().filter((row) => row.expiresAt > now);
  if (rows.filter((row) => row.userId === pairing.userId).length >= 10) throw new Error("Remove an existing browser before pairing another.");
  const token = `bbr_${randomBytes(32).toString("base64url")}`;
  const device = { id: randomBytes(16).toString("hex"), userId: pairing.userId, name: name.slice(0, 100), extensionOrigin, tokenHash: digest(token), expiresAt: now + 30 * 86_400_000 };
  save([...rows, device]);
  codes.delete(key);
  return { device, token };
}
export function browserDevice(token: string | null, origin: string, now = Date.now()): BrowserDevice | null {
  if (!token) return null;
  return listDevices().find((row) => row.tokenHash === digest(token) && row.extensionOrigin === origin && row.expiresAt > now && !!getUserById(row.userId)) ?? null;
}
export function revokeBrowser(id: string): void {
  save(listDevices().filter((row) => row.id !== id));
}
