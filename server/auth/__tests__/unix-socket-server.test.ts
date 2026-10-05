import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readPeerCredentials, socketFileDescriptor } from "../unix-socket-server.ts";

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("readPeerCredentials", () => {
  test("reads the uid and pid of a real Unix-socket peer", async () => {
    dir = mkdtempSync(join(tmpdir(), "bureau-unix-peer-"));
    const path = join(dir, "peer.sock");
    let resolvePeer!: (peer: { pid: number; uid: number } | null) => void;
    const peer = new Promise<{ pid: number; uid: number } | null>((resolve) => (resolvePeer = resolve));
    const server = Bun.listen({
      unix: path,
      socket: {
        open: (socket) => {
          const fd = socketFileDescriptor(socket);
          resolvePeer(fd === null ? null : readPeerCredentials(fd));
          socket.end();
        },
        data: () => {},
      },
    });
    try {
      const client = await Bun.connect({ unix: path, socket: { data: () => {} } });
      expect(await peer).toEqual({ pid: process.pid, uid: process.getuid!() });
      client.end();
    } finally {
      server.stop(true);
    }
  });
});
