import { createServer, type Server } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import type { IntegrationStore } from "../store.ts";
import { proxyCredentials } from "./credentials.ts";
import type { ProxyMaterial } from "./material.ts";
import { connectDestination } from "./connect.ts";
import { forwardRequest, type ForwardOptions } from "./forward.ts";
import { excludedSecretHost } from "../../../shared/integrations/connections.ts";

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Credential proxy did not bind a TCP port."));
        return;
      }
      server.unref();
      resolve(address.port);
    });
  });
}
function relay(left: Duplex, right: Duplex, head: Buffer) {
  left.on("error", () => right.destroy());
  right.on("error", () => left.destroy());
  left.on("close", () => right.destroy());
  right.on("close", () => left.destroy());
  if (head.length) right.write(head);
  left.pipe(right);
  right.pipe(left);
}
export async function startCredentialProxy(store: IntegrationStore, material: ProxyMaterial, options: ForwardOptions = {}) {
  const secureServers = new Map<string, Promise<{ server: Server; port: number }>>();
  const sockets = new Set<Socket>();
  let stopped = false;
  const track = (server: Server) =>
    server.on("connection", (socket: Socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
  async function securePort(host: string): Promise<number> {
    let pending = secureServers.get(host);
    if (!pending) {
      pending = (async () => {
        const certificate = await material.certificate(host);
        if (stopped) throw new Error("Credential proxy is stopped.");
        const server = createSecureServer(certificate, (req, res) => {
          try {
            if (!req.url?.startsWith("/") || req.url.startsWith("//")) throw new Error("Invalid proxy path.");
            const destination = new URL(req.url, `https://${host}`);
            if (destination.hostname !== host) throw new Error("Proxy host mismatch.");
            forwardRequest(req, res, destination, proxyCredentials(store, material.placeholderKey), options);
          } catch {
            res.writeHead(403).end("Credential proxy refused this request.");
          }
        });
        track(server);
        const port = await listen(server);
        return { server, port };
      })();
      secureServers.set(host, pending);
      void pending.catch(() => secureServers.delete(host));
    }
    return (await pending).port;
  }
  const server = createServer((req, res) => {
    try {
      const destination = new URL(req.url ?? "");
      if (destination.protocol !== "http:" || destination.username || destination.password) throw new Error("Invalid proxy URL.");
      forwardRequest(req, res, destination, [], options);
    } catch {
      res.writeHead(400).end("Use an HTTP proxy request or an HTTPS CONNECT tunnel.");
    }
  });
  track(server);
  server.on("connect", (req, socket, head) => {
    void (async () => {
      try {
        const authority = req.url ?? "";
        if (!authority || /[\s/@?#]/.test(authority)) throw new Error("Invalid CONNECT authority.");
        const target = new URL(`https://${authority}`);
        const host = target.hostname.replace(/^\[|\]$/g, "");
        const port = Number(target.port || 443);
        const credentials = proxyCredentials(store, material.placeholderKey);
        const terminate = port === 443 && !excludedSecretHost(host) && credentials.some(({ secret }) => secret.hosts.includes(host));
        let upstream: Duplex;
        if (terminate) {
          const localPort = await securePort(host);
          upstream = await new Promise<Socket>((resolve, reject) => {
            const connection = connect(localPort, "127.0.0.1", () => resolve(connection));
            connection.once("error", reject);
          });
        } else {
          const destination = options.target?.(host, port) ?? { host, port };
          upstream = await connectDestination(destination.host, destination.port, options.proxyUrl, options.noProxy);
        }
        if (stopped || socket.destroyed) {
          upstream.destroy();
          return;
        }
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        relay(socket, upstream, head);
      } catch {
        if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      }
    })();
  });
  const port = await listen(server);
  return {
    port,
    async close() {
      stopped = true;
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        [server, ...(await Promise.allSettled(secureServers.values())).flatMap((result) => (result.status === "fulfilled" ? [result.value.server] : []))].map(
          (listener) => new Promise<void>((resolve) => listener.close(() => resolve())),
        ),
      );
    },
  };
}
