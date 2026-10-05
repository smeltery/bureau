import { describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { mintAgentToken, revokeAgentToken } from "../../agents/tokens.ts";
import { authenticate } from "../auth-middleware.ts";
import { refuseOffBoxMachineToken } from "../machine-token-locality.ts";

function serverSeeing(address: string): Server<unknown> {
  return { requestIP: () => ({ address, family: "IPv4", port: 1234 }) } as unknown as Server<unknown>;
}

describe("loopback trust on the agent HTTP API", () => {
  test("a local process with no forwarding header is trusted as loopback", () => {
    const req = new Request("http://127.0.0.1/api/tasks");
    expect(authenticate(req, serverSeeing("127.0.0.1"), { allowLoopback: true }).kind).toBe("loopback");
  });

  test("an outside client relayed by a same-host proxy needs a session", () => {
    const relays: Record<string, string>[] = [{ "X-Forwarded-For": "203.0.113.9" }, { Forwarded: "for=203.0.113.9" }, { "X-Forwarded-Proto": "https" }];
    for (const headers of relays) {
      const req = new Request("http://127.0.0.1/api/tasks", { headers });
      expect(authenticate(req, serverSeeing("127.0.0.1"), { allowLoopback: true }).kind).toBe("rejected");
    }
  });
});

describe("machine tokens off-box", () => {
  const withBearer = (token: string) => new Request("http://127.0.0.1/api/tasks", { headers: { Authorization: `Bearer ${token}` } });

  test("an agent token works on-box and is refused off-box", () => {
    const token = mintAgentToken("locality-agent", null);
    try {
      expect(refuseOffBoxMachineToken(withBearer(token), true)).toBeNull();
      expect(refuseOffBoxMachineToken(withBearer(token), false)?.status).toBe(401);
    } finally {
      revokeAgentToken("locality-agent");
    }
  });

  test("other bearers are left to the routes", () => {
    expect(refuseOffBoxMachineToken(withBearer("not-a-machine-token"), false)).toBeNull();
    expect(refuseOffBoxMachineToken(new Request("http://127.0.0.1/api/tasks"), false)).toBeNull();
  });
});
