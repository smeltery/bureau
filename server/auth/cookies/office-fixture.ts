import { freezeAppHostDomain } from "../../apps/domain.ts";
import { claimUserByName } from "../../users.ts";
import { createSessionForUser } from "../session-creation.ts";
import { sessionStore, persistSessions } from "../store.ts";
import { COOKIE_NAME, freezeBootState } from "../auth.ts";
import { createFetchHandler } from "../../http/router.ts";
import type { WsData } from "../../ws/websocket-handlers.ts";

const owner = claimUserByName("Cookie Owner", { role: "owner" });
const primary = createSessionForUser(owner.id, null);
const recovery = createSessionForUser(owner.id, null);
for (const entry of [primary, recovery]) sessionStore().set(entry.sessionHash, entry.session);
persistSessions();
const server = Bun.serve<WsData>({
  hostname: "localhost",
  port: 0,
  fetch: createFetchHandler(),
  websocket: {
    open(socket) {
      socket.send(JSON.stringify({ user: "session" in socket.data ? socket.data.session?.username : null }));
    },
    message() {},
  },
});
process.env.PORT = String(server.port);
freezeBootState({ externalAccess: false, networkBind: "loopback" });
freezeAppHostDomain();
console.log("COOKIE_FIXTURE=" + JSON.stringify({ base: `http://localhost:${server.port}`, name: COOKIE_NAME, raw: primary.rawSessionId }));
