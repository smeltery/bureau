import { connect, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";

export function bypassProxy(host: string, port: number, noProxy: string): boolean {
  return noProxy.split(",").some((part) => {
    const rule = part.trim().toLowerCase();
    if (!rule) return false;
    if (rule === "*") return true;
    const [domain, rulePort] = rule.split(":");
    if (rulePort && Number(rulePort) !== port) return false;
    const suffix = domain!.replace(/^\./, "");
    return host === suffix || host.endsWith(`.${suffix}`);
  });
}

export async function connectDestination(host: string, port: number, proxyUrl?: string, noProxy = ""): Promise<Socket | TLSSocket> {
  const proxy = proxyUrl && !bypassProxy(host, port, noProxy) ? new URL(proxyUrl) : null;
  if (proxy && proxy.protocol !== "http:" && proxy.protocol !== "https:") throw new Error("Unsupported company proxy protocol.");
  const socket = await new Promise<Socket | TLSSocket>((resolve, reject) => {
    const target = proxy ? { host: proxy.hostname, port: Number(proxy.port || (proxy.protocol === "https:" ? 443 : 80)) } : { host, port };
    const connection = proxy?.protocol === "https:" ? connectTls({ ...target, servername: proxy.hostname }) : connect(target);
    const event = proxy?.protocol === "https:" ? "secureConnect" : "connect";
    const timer = setTimeout(() => connection.destroy(new Error("Proxy connection timed out.")), 15_000);
    connection.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    connection.once(event, () => {
      clearTimeout(timer);
      resolve(connection);
    });
  });
  if (!proxy) return socket;
  try {
    await new Promise<void>((resolve, reject) => {
      let header = Buffer.alloc(0);
      const timer = setTimeout(() => finish(new Error("Company proxy timed out.")), 15_000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        socket.off("data", receive);
        socket.off("error", fail);
        socket.off("close", closed);
        if (error) reject(error);
        else resolve();
      };
      const fail = (error: Error) => finish(error);
      const closed = () => finish(new Error("Company proxy closed the connection."));
      const receive = (chunk: Buffer) => {
        header = Buffer.concat([header, chunk]);
        if (header.length > 16 * 1024) return finish(new Error("Company proxy headers are too large."));
        const end = header.indexOf("\r\n\r\n");
        if (end < 0) return;
        socket.pause();
        if (!/^HTTP\/1\.[01] 200(?: |\r)/.test(header.subarray(0, end).toString("latin1"))) return finish(new Error("Company proxy refused the tunnel."));
        if (header.length > end + 4) socket.unshift(header.subarray(end + 4));
        finish();
      };
      socket.on("data", receive);
      socket.once("error", fail);
      socket.once("close", closed);
      const credentials =
        proxy.username || proxy.password ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}\r\n` : "";
      const authority = host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${credentials}\r\n`);
    });
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}
