import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import * as AgentManager from "../../agent-manager.ts";
import type { AgentInfo } from "../../../shared/types.ts";
import { claimUserByName, deleteUserById } from "../../users.ts";
import { handleAgentSpawnRequest } from "../agent-spawn-route.ts";

const owner = claimUserByName("Spawn Room Owner", { role: "owner" });
const ownerAuth: AuthResult = {
  kind: "ok",
  session: { sessionIdHash: "hash", sessionPrefix: "sess", userId: owner.id, username: "Spawn Room Owner", role: "owner", needsRolling: false, absoluteExpiresAt: Date.now() + 86_400_000 },
};
afterAll(() => deleteUserById(owner.id));

const room = () => AgentManager.getRooms()[0]!;
const spawnRequest = (body: Record<string, unknown>) =>
  handleAgentSpawnRequest(
    new Request("http://local.test/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Rae", roomId: room().id, desk: 0, ...body }) }),
    ownerAuth,
  );

afterEach(() => AgentManager.setRoomCwd(room().id, null));

test("an agent created without a cwd starts in its room's default folder", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bureau-spawn-cwd-"));
  const spawn = spyOn(AgentManager, "spawn").mockResolvedValue({ id: "agent-rae" } as AgentInfo);
  try {
    AgentManager.setRoomCwd(room().id, folder);
    expect((await spawnRequest({}))?.status).toBe(201);
    expect(spawn.mock.calls[0]?.[1]).toBe(folder);

    // An explicit cwd still wins over the room's folder.
    expect((await spawnRequest({ cwd: tmpdir() }))?.status).toBe(201);
    expect(spawn.mock.calls[1]?.[1]).toBe(tmpdir());
  } finally {
    spawn.mockRestore();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("an agent created without a cwd in a room with no folder is refused", async () => {
  const spawn = spyOn(AgentManager, "spawn");
  try {
    const res = await spawnRequest({});
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "cwd is required when the room has no default folder" });
    expect(spawn).not.toHaveBeenCalled();
  } finally {
    spawn.mockRestore();
  }
});
