import { randomBytes } from "node:crypto";
import type { SharedBrowserAction, SharedBrowserCommand, SharedTabGrant } from "../../shared/integrations/browser-sharing.ts";
import * as Agents from "../agent-manager.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import { listDevices, type BrowserDevice } from "./devices.ts";

const grants = new Map<string, SharedTabGrant>();
interface Pending {
  command: SharedBrowserCommand;
  deviceId: string;
  agentId: string;
  delivered: boolean;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
const pending = new Map<string, Pending>();
const id = () => randomBytes(16).toString("hex");
export function eligibleAgent(userId: string, agentId: string): boolean {
  const user = getUserById(userId);
  const agent = Agents.getAgent(agentId);
  return !!user && !!agent && agent.userId === userId && canSeeRoom(user, Agents.getRooms()[agent.room]?.id);
}
export function revokeGrant(grantId: string): void {
  grants.delete(grantId);
  for (const [key, item] of pending)
    if (item.command.grantId === grantId) {
      clearTimeout(item.timer);
      pending.delete(key);
      item.reject(new Error("tab sharing revoked"));
    }
}
export function revokeDeviceGrants(deviceId: string): void {
  for (const grant of grants.values()) if (grant.deviceId === deviceId) revokeGrant(grant.id);
}
export function currentGrants(now = Date.now()): SharedTabGrant[] {
  const devices = listDevices();
  for (const grant of grants.values()) {
    if (
      (grant.expiresAt !== null && grant.expiresAt <= now) ||
      !devices.some((device) => device.id === grant.deviceId && device.expiresAt > now) ||
      !grant.agentIds.every((agentId) => eligibleAgent(grant.userId, agentId))
    )
      revokeGrant(grant.id);
  }
  return [...grants.values()];
}
export function grantTab(device: BrowserDevice, input: unknown, now = Date.now()): SharedTabGrant {
  const body = input as Record<string, unknown> | null;
  if (!body || !Number.isSafeInteger(body.tabId) || (body.tabId as number) < 0 || typeof body.url !== "string" || body.url.length > 4096 || typeof body.title !== "string")
    throw new Error("invalid tab");
  const url = new URL(body.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only HTTP and HTTPS tabs can be shared.");
  if (!Array.isArray(body.agentIds) || !body.agentIds.length || body.agentIds.length > 8 || !body.agentIds.every((agentId) => typeof agentId === "string" && eligibleAgent(device.userId, agentId)))
    throw new Error("Choose agents you manage in an accessible room.");
  if (body.minutes !== null && body.minutes !== 15 && body.minutes !== 60) throw new Error("Choose 15 minutes, 60 minutes, or no expiry.");
  const existing = currentGrants(now);
  for (const grant of existing) if (grant.deviceId === device.id && grant.tabId === body.tabId) revokeGrant(grant.id);
  if (currentGrants(now).filter((grant) => grant.deviceId === device.id).length >= 20) throw new Error("Too many shared tabs");
  const grant: SharedTabGrant = {
    id: id(),
    deviceId: device.id,
    userId: device.userId,
    tabId: body.tabId as number,
    origin: url.origin,
    title: body.title.slice(0, 200),
    agentIds: [...new Set(body.agentIds as string[])],
    expiresAt: body.minutes === null ? null : now + (body.minutes as number) * 60_000,
  };
  grants.set(grant.id, grant);
  return grant;
}
export function parseBrowserAction(value: unknown, origin: string): SharedBrowserAction {
  const input = value as Record<string, unknown> | null;
  if (!input) throw new Error("action required");
  if (input.action === "read" || input.action === "screenshot") return { action: input.action };
  if (input.action === "navigate" && typeof input.url === "string") {
    const url = new URL(input.url);
    if (url.origin !== origin || url.username || url.password) throw new Error("Navigation must remain on the shared origin. Offer a new tab for another origin.");
    return { action: "navigate", url: url.href };
  }
  if ((input.action === "click" || input.action === "type") && typeof input.selector === "string" && input.selector.length > 0 && input.selector.length <= 500) {
    if (input.action === "click") return { action: "click", selector: input.selector };
    if (typeof input.text === "string" && input.text.length <= 10_000) return { action: "type", selector: input.selector, text: input.text };
  }
  throw new Error("Unsupported browser action or invalid arguments");
}
export function requestBrowserAction(agentId: string, grantId: string, input: unknown, timeoutMs = 15_000): Promise<unknown> {
  const grant = currentGrants().find((row) => row.id === grantId && row.agentIds.includes(agentId));
  if (!grant || !eligibleAgent(grant.userId, agentId)) return Promise.reject(new Error("tab grant unavailable"));
  if ([...pending.values()].some((item) => item.command.grantId === grantId)) return Promise.reject(new Error("tab is busy"));
  const action = parseBrowserAction(input, grant.origin);
  const command: SharedBrowserCommand = { id: id(), grantId, tabId: grant.tabId, origin: grant.origin, input: action };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(command.id);
      revokeGrant(grantId);
      reject(new Error("browser action timed out; tab sharing was revoked"));
    }, timeoutMs);
    timer.unref?.();
    pending.set(command.id, { command, deviceId: grant.deviceId, agentId, delivered: false, resolve, reject, timer });
  });
}
export function pollBrowser(deviceId: string): { grants: SharedTabGrant[]; commands: SharedBrowserCommand[] } {
  const visible = currentGrants().filter((grant) => grant.deviceId === deviceId);
  const commands = [...pending.values()].filter((item) => item.deviceId === deviceId && !item.delivered);
  for (const item of commands) item.delivered = true;
  return { grants: visible, commands: commands.map((item) => item.command) };
}
export function completeBrowserAction(deviceId: string, commandId: string, result: unknown, error?: string): boolean {
  currentGrants();
  const item = pending.get(commandId);
  if (!item || item.deviceId !== deviceId || !item.delivered) return false;
  pending.delete(commandId);
  clearTimeout(item.timer);
  if (error) item.reject(new Error(error.slice(0, 300)));
  else item.resolve(result);
  return true;
}
