import { afterEach, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import * as Agents from "../../../agent-manager.ts";
import { claimUserByName, deleteUserById, getWsUser, projectRooms, updateUserById } from "../../../users.ts";
import { bindWsUser, clearWsUser } from "../../../user-sockets.ts";
import { browsers } from "../../../ws/broadcast.ts";
import { applyViewPreference } from "../../access-adapters.ts";
const users: string[] = [],
  rooms: string[] = [],
  sockets: ServerWebSocket<unknown>[] = [];
afterEach(() => {
  for (const ws of sockets.splice(0)) {
    browsers.delete(ws);
    clearWsUser(ws);
  }
  for (const id of users.splice(0)) deleteUserById(id);
  for (const id of rooms.splice(0)) Agents.closeRoom(id);
});
test("personal ordering updates only the viewer, preserves office order and refreshes socket permissions", () => {
  rooms.push(Agents.createRoom("View A"), Agents.createRoom("View B"));
  const events: any[][] = [];
  for (let i = 0; i < 2; i++) {
    const user = claimUserByName(crypto.randomUUID(), { role: "member", allowedRooms: [...rooms] });
    users.push(user.id);
    const sent: any[] = [];
    events.push(sent);
    const ws = {
      send: (text: string) => {
        sent.push(JSON.parse(text));
        return 0;
      },
    } as ServerWebSocket<unknown>;
    bindWsUser(ws, user);
    browsers.add(ws);
    sockets.push(ws);
  }
  const officeOrder = Agents.getRooms().map((room) => room.id);
  expect(applyViewPreference(users[0], { order: [rooms[1], rooms[0]] })).toBe(true);
  expect(events[0]).toEqual([{ type: "rooms_reordered", order: [rooms[1], rooms[0]] }]);
  expect(events[1]).toEqual([]);
  expect(Agents.getRooms().map((room) => room.id)).toEqual(officeOrder);
  expect(projectRooms(getWsUser(sockets[0]), Agents.getRooms()).map((room) => room.id)).toEqual([rooms[1], rooms[0]]);
  expect(applyViewPreference(users[0], { shown: [rooms[1]] })).toBe(true);
  expect(events[0].find((event) => event.type === "full_state").rooms.map((room: { id: string }) => room.id)).toEqual([rooms[1]]);
  expect(events[1]).toEqual([]);
  updateUserById(users[0], { allowedRooms: [] });
  expect(getWsUser(sockets[0])?.allowedRooms).toEqual([]);
});
