import { afterEach, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import * as CronjobManager from "../cronjobs/index.ts";
import { claimUserByName, deleteUserById } from "../users.ts";
import { bindWsUser, clearWsUser } from "../user-sockets.ts";
import { handleCronjobCommand } from "./cronjob-commands.ts";

const sockets: ServerWebSocket<unknown>[] = [];
const userIds: string[] = [];
function wsSink(sent: string[]): ServerWebSocket<unknown> {
  const ws = {
    send(message: string) {
      sent.push(message);
      return 0;
    },
  } as ServerWebSocket<unknown>;
  const user = claimUserByName(`WS schedule owner ${crypto.randomUUID()}`, { role: "owner" });
  userIds.push(user.id);
  sockets.push(ws);
  bindWsUser(ws, user);
  return ws;
}

afterEach(() => {
  for (const ws of sockets.splice(0)) clearWsUser(ws);
  for (const id of userIds.splice(0)) deleteUserById(id);
  for (const job of CronjobManager.listCronjobs()) CronjobManager.deleteCronjob(job.id);
});

describe("handleCronjobCommand", () => {
  test("rejects malformed cronjob schedules over websocket", () => {
    const sent: string[] = [];

    const handled = handleCronjobCommand(
      {
        type: "add_cronjob",
        requestId: "req-1",
        name: "Bad schedule",
        schedule: { type: "daily", hour: "9", minute: 0 },
        prompt: "Check the queue",
        cwd: process.cwd(),
        modelFamily: "opus",
        effort: "high",
        permissionMode: "bypassPermissions",
        username: "Owner",
      } as never,
      wsSink(sent),
    );

    expect(handled).toBe(true);
    expect(CronjobManager.listCronjobs()).toEqual([]);
    expect(JSON.parse(sent[0]!)).toEqual({
      type: "agent_save_response",
      requestId: "req-1",
      ok: false,
      error: "schedule must be manual, daily, weekly, or interval with finite numeric fields",
    });
  });

  test("rejects malformed cronjob update schedules over websocket", () => {
    const cronjob = CronjobManager.addCronjob({
      name: "Update schedule",
      schedule: { type: "daily", hour: 9, minute: 0 },
      prompt: "Check",
      cwd: process.cwd(),
      agentType: "claude",
      modelFamily: "opus",
      effort: "high",
      permissionMode: "bypassPermissions",
      username: "Owner",
      userId: "owner-1",
    });
    const sent: string[] = [];

    handleCronjobCommand(
      {
        type: "update_cronjob",
        requestId: "req-2",
        id: cronjob.id,
        changes: { schedule: { type: "interval", minutes: null } },
      } as never,
      wsSink(sent),
    );

    expect(CronjobManager.listCronjobs()[0]?.schedule).toEqual({ type: "daily", hour: 9, minute: 0 });
    expect(JSON.parse(sent[0]!)).toEqual({
      type: "agent_save_response",
      requestId: "req-2",
      ok: false,
      error: "schedule must be manual, daily, weekly, or interval with finite numeric fields",
    });
  });

  test("rejects Claude-shaped Codex models over websocket", () => {
    const cronjob = CronjobManager.addCronjob({
      name: "WS Codex",
      schedule: { type: "daily", hour: 9, minute: 0 },
      prompt: "Check",
      cwd: process.cwd(),
      agentType: "codex",
      modelFamily: "gpt-7-x",
      effort: "medium",
      permissionMode: "never",
      username: "Owner",
      userId: "owner-1",
    });
    const sent: string[] = [];

    handleCronjobCommand(
      {
        type: "update_cronjob",
        requestId: "req-model",
        id: cronjob.id,
        changes: { modelFamily: "fable-5" },
      } as never,
      wsSink(sent),
    );

    expect(CronjobManager.listCronjobs()[0]?.modelFamily).toBe("gpt-7-x");
    expect(JSON.parse(sent[0]!)).toEqual({
      type: "agent_save_response",
      requestId: "req-model",
      ok: false,
      error: '"fable-5" is not a Codex model.',
    });
  });
});
