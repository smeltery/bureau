import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { agents } from "../agents/state.ts";
import { createManagedAgent } from "../agents/managed-factory.ts";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo, type UserRecord } from "../../shared/types.ts";
import * as Agents from "../agent-manager.ts";
import { claimUserByName, deleteUserById, updateUserById } from "../users.ts";
import { browserDevice, createPairingCode, DEVICES_FILE, pairBrowser, revokeBrowser } from "./devices.ts";
import { completeBrowserAction, currentGrants, grantTab, pollBrowser, requestBrowserAction, revokeDeviceGrants, revokeGrant } from "./broker.ts";
import { handleBrowserSharingRequest, handleExtensionRequest } from "./routes.ts";
import { mintAgentToken, revokeAgentToken } from "../agents/tokens.ts";

import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = "chrome-extension://" + "a".repeat(32);
const users: UserRecord[] = [],
  roomIds: string[] = [],
  agentIds: string[] = [];
afterEach(() => {
  for (const grant of currentGrants()) revokeGrant(grant.id);
  for (const id of agentIds.splice(0)) {
    agents.delete(id);
    revokeAgentToken(id);
  }
  for (const user of users.splice(0)) deleteUserById(user.id);
  for (const id of roomIds.splice(0)) Agents.closeRoom(id);
  rmSync(DEVICES_FILE, { force: true });
});
function setup() {
  const roomId = Agents.createRoom("Shared browser");
  roomIds.push(roomId);
  const user = claimUserByName(crypto.randomUUID(), { role: "member", allowedRooms: [roomId] });
  users.push(user);
  const id = crypto.randomUUID();
  agentIds.push(id);
  const info: AgentInfo = {
    id,
    userId: user.id,
    name: "Browser helper",
    desk: 0,
    room: Agents.getRooms().findIndex((room) => room.id === roomId),
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
    effort: "high",
  };
  agents.set(id, createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] }));
  const code = createPairingCode(user.id),
    paired = pairBrowser(code, "Test browser", origin)!;
  const input = { tabId: 1, url: "https://example.com/private", title: "Offered tab", agentIds: [id], minutes: 15 };
  return { user, id, code, paired, input };
}
test("pairing is single-use, origin-bound, expires and can be revoked", () => {
  const { user, code, paired } = setup();
  expect(pairBrowser(code, "Again", origin)).toBeNull();
  expect(browserDevice(paired.token, origin)?.userId).toBe(user.id);
  expect(browserDevice(paired.token, "chrome-extension://" + "b".repeat(32))).toBeNull();
  expect(browserDevice(paired.token, origin, paired.device.expiresAt)).toBeNull();
  const expired = createPairingCode(user.id, 1000);
  expect(pairBrowser(expired, "Expired", origin, 301000)).toBeNull();
  revokeBrowser(paired.device.id);
  expect(browserDevice(paired.token, origin)).toBeNull();
});
test("only offered agents and tabs receive one delivery, with restricted actions", async () => {
  const { id, paired, input } = setup();
  expect(() => grantTab(paired.device, { ...input, url: "file:///secret" })).toThrow();
  expect(() => grantTab(paired.device, { ...input, agentIds: ["other"] })).toThrow();
  const grant = grantTab(paired.device, input);
  await expect(requestBrowserAction("other", grant.id, { action: "read" })).rejects.toThrow();
  expect(() => requestBrowserAction(id, grant.id, { action: "evaluate", script: "alert(1)" })).toThrow();
  expect(() => requestBrowserAction(id, grant.id, { action: "navigate", url: "https://other.test" })).toThrow();
  const result = requestBrowserAction(id, grant.id, { action: "read" });
  expect(pollBrowser("other").commands).toHaveLength(0);
  const command = pollBrowser(paired.device.id).commands[0]!;
  expect(pollBrowser(paired.device.id).commands).toHaveLength(0);
  expect(completeBrowserAction("other", command.id, "secret")).toBe(false);
  expect(completeBrowserAction(paired.device.id, command.id, { text: "visible" })).toBe(true);
  expect(await result).toEqual({ text: "visible" });
  expect(completeBrowserAction(paired.device.id, command.id, "replay")).toBe(false);
});
test("revocation, expiry, permission loss and timeout cancel pending work", async () => {
  const { id, user, paired, input } = setup();
  for (const revoke of [() => revokeDeviceGrants(paired.device.id), () => currentGrants(Date.now() + 3600000), () => updateUserById(user.id, { allowedRooms: [] })]) {
    const grant = grantTab(paired.device, input);
    const result = requestBrowserAction(id, grant.id, { action: "read" });
    const rejected = result.catch((error: Error) => error);
    revoke();
    currentGrants();
    expect(((await rejected) as Error).message).toContain("revoked");
  }
  updateUserById(user.id, { allowedRooms: roomIds });
  const grant = grantTab(paired.device, input);
  await expect(requestBrowserAction(id, grant.id, { action: "read" }, 5)).rejects.toThrow("timed out");
  expect(currentGrants()).toHaveLength(0);
});
test("HTTP rejects foreign origins, unpaired clients and mismatched agent bearers", async () => {
  const { id, paired, input } = setup();
  grantTab(paired.device, input);
  const extension = async (headers: HeadersInit) => {
    const req = new Request("http://local/browser-sharing/extension/poll", { headers });
    return handleExtensionRequest(req, new URL(req.url));
  };
  expect((await extension({ origin: "https://evil.test", authorization: `Bearer ${paired.token}` }))?.status).toBe(403);
  expect((await extension({ origin }))?.status).toBe(401);
  expect((await extension({ origin, authorization: `Bearer ${paired.token}` }))?.status).toBe(200);
  expect((await extension({ "x-bureau-extension": "a".repeat(32), authorization: `Bearer ${paired.token}` }))?.status).toBe(200);
  expect((await extension({ origin, "x-bureau-extension": "b".repeat(32), authorization: `Bearer ${paired.token}` }))?.status).toBe(403);
  const token = mintAgentToken(id, users[0].id);
  for (const [target, status] of [
    [id, 200],
    ["other", 403],
  ] as const) {
    const req = new Request(`http://local/api/agents/${target}/shared-browser`, { headers: { authorization: `Bearer ${token}` } });
    expect((await handleBrowserSharingRequest(req, new URL(req.url), { kind: "loopback" }))?.status).toBe(status);
  }
});

test("uploads are authorized before reading and transfer only the bounded file payload", async () => {
  const { id, paired, input } = setup();
  const root = mkdtempSync(join(tmpdir(), "bureau-upload-"));
  const path = join(root, "report.txt");
  writeFileSync(path, "Upload contents");
  const resolve = spyOn(Agents, "resolveEditorPathForAgent").mockReturnValue(path);
  try {
    const grant = grantTab(paired.device, input);
    const upload = { action: "upload", selector: "#file", path: "report.txt" };
    await expect(requestBrowserAction("other", grant.id, upload)).rejects.toThrow("unavailable");
    expect(resolve).not.toHaveBeenCalled();
    const req = new Request(`http://local/api/agents/${id}/shared-browser`, { method: "POST", body: JSON.stringify({ ...upload, grantId: grant.id }) });
    expect((await handleBrowserSharingRequest(req, new URL(req.url), { kind: "loopback" }))?.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
    const result = requestBrowserAction(id, grant.id, upload);
    const command = pollBrowser(paired.device.id).commands[0]!;
    expect(resolve).toHaveBeenCalledWith(id, "report.txt");
    expect(command.input).toEqual({
      action: "upload",
      selector: "#file",
      file: { name: "report.txt", mimeType: "text/plain;charset=utf-8", base64: Buffer.from("Upload contents").toString("base64") },
    });
    await expect(requestBrowserAction(id, grant.id, upload)).rejects.toThrow("busy");
    expect(resolve).toHaveBeenCalledTimes(1);
    const rejected = result.catch((error: Error) => error);
    revokeGrant(grant.id);
    expect(((await rejected) as Error).message).toContain("revoked");
    expect(completeBrowserAction(paired.device.id, command.id, {})).toBe(false);
    await expect(requestBrowserAction(id, grant.id, upload)).rejects.toThrow("unavailable");
    expect(resolve).toHaveBeenCalledTimes(1);
  } finally {
    resolve.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("upload refuses invalid paths, protected files and oversized files without queuing a command", () => {
  const { id, paired, input } = setup();
  const grant = grantTab(paired.device, input);
  const root = mkdtempSync(join(tmpdir(), "bureau-upload-"));
  const resolve = spyOn(Agents, "resolveEditorPathForAgent");
  try {
    for (const path of ["", "x".repeat(4097), "bad\0path"]) {
      expect(() => requestBrowserAction(id, grant.id, { action: "upload", selector: "#file", path })).toThrow("path");
    }
    expect(resolve).not.toHaveBeenCalled();
    for (const [name, bytes] of [
      [".env", Buffer.from("secret")],
      ["large.txt", Buffer.alloc(1024 * 1024 + 1)],
    ] as const) {
      const path = join(root, name);
      writeFileSync(path, bytes);
      resolve.mockReturnValue(path);
      expect(() => requestBrowserAction(id, grant.id, { action: "upload", selector: "#file", path })).toThrow("non-sensitive regular file");
    }
    expect(pollBrowser(paired.device.id).commands).toHaveLength(0);
  } finally {
    resolve.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});
