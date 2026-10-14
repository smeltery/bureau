import { request as requestHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { Agent, request as requestHttps } from "node:https";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { pipeline } from "node:stream";
import type { Duplex } from "node:stream";
import { bypassProxy, connectDestination } from "./connect.ts";
import { injectCredentials, type ProxyCredential } from "./credentials.ts";
import { scrubBuffer, SecretScrubber, secretPatterns } from "./scrub.ts";

const hopHeaders = ["connection", "proxy-connection", "proxy-authorization", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"];
export interface ForwardOptions {
  proxyUrl?: string;
  noProxy?: string;
  // Test-only transport routing and roots; production never disables certificate verification.
  target?: (host: string, port: number) => { host: string; port: number };
  ca?: string;
  used?: (credentials: ProxyCredential[]) => void;
}
class DestinationAgent extends Agent {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly settings: ForwardOptions,
  ) {
    super({ keepAlive: false });
  }
  override createConnection(_options: unknown, callback: (error: Error | null, stream: Duplex) => void): Duplex | null | undefined {
    const target = this.settings.target?.(this.host, this.port) ?? { host: this.host, port: this.port };
    void connectDestination(target.host, target.port, this.settings.proxyUrl, this.settings.noProxy)
      .then((socket) => {
        const secure = tlsConnect({ socket, servername: this.host, ...(this.settings.ca ? { ca: this.settings.ca } : {}) });
        let settled = false;
        const finish = (error: Error | null) => {
          if (settled) return;
          settled = true;
          secure.setTimeout(0);
          callback(error, secure);
        };
        secure.setTimeout(15_000, () => secure.destroy(new Error("Destination TLS handshake timed out.")));
        secure.once("secureConnect", () => finish(null));
        secure.once("error", finish);
        socket.resume();
      })
      .catch((error) => callback(error, undefined as unknown as Duplex));
    return undefined;
  }
}
export function forwardRequest(req: IncomingMessage, res: ServerResponse, destination: URL, credentials: ProxyCredential[], options: ForwardOptions): void {
  try {
    if (req.method === "CONNECT" || req.headers.upgrade) throw new Error("Nested tunnels are unavailable.");
    const host = destination.hostname;
    const incomingHost = req.headers.host?.toLowerCase();
    if (destination.protocol === "https:" && incomingHost !== host && incomingHost !== `${host}:443`) throw new Error("Proxy destination mismatch.");
    const sni = (req.socket as TLSSocket & { servername?: string }).servername;
    if (sni && sni !== host) throw new Error("Proxy TLS name mismatch.");
    const injected = injectCredentials(host, req.headers, credentials);
    const headers = injected.headers;
    const connectionNames = String(headers.connection ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase());
    for (const name of [...hopHeaders, ...connectionNames]) delete headers[name];
    headers.host = destination.host;
    headers["accept-encoding"] = "identity";
    const patterns = secretPatterns(credentials.map((credential) => credential.secret.value));
    const agent = destination.protocol === "https:" ? new DestinationAgent(host, Number(destination.port || 443), options) : undefined;
    const company = destination.protocol === "http:" && options.proxyUrl && !bypassProxy(host, Number(destination.port || 80), options.noProxy ?? "") ? new URL(options.proxyUrl) : null;
    if (company && !["http:", "https:"].includes(company.protocol)) throw new Error("Unsupported company proxy protocol.");
    if (company && (company.username || company.password))
      headers["proxy-authorization"] = `Basic ${Buffer.from(`${decodeURIComponent(company.username)}:${decodeURIComponent(company.password)}`).toString("base64")}`;
    const target = company ?? destination;
    const request = target.protocol === "https:" ? requestHttps : requestHttp;
    const upstream = request(target, { method: req.method, headers, ...(company ? { path: destination.href } : {}), ...(agent ? { agent } : {}) }, (response) => {
      const responseHeaders = { ...response.headers };
      const encoding = responseHeaders["content-encoding"]?.toLowerCase();
      const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : null;
      if (encoding && encoding !== "identity" && !decoder) {
        response.destroy();
        res.writeHead(502).end("Unsupported upstream response encoding.");
        return;
      }
      for (const name of [...hopHeaders, "content-length", "content-encoding"]) delete responseHeaders[name];
      for (const [name, value] of Object.entries(responseHeaders)) {
        if (typeof value === "string") responseHeaders[name] = scrubBuffer(Buffer.from(value), patterns).toString();
        else if (Array.isArray(value)) responseHeaders[name] = value.map((item) => scrubBuffer(Buffer.from(item), patterns).toString());
      }
      res.writeHead(response.statusCode ?? 502, responseHeaders);
      const scrubber = new SecretScrubber(patterns);
      const done = (error: NodeJS.ErrnoException | null) => {
        agent?.destroy();
        if (error) res.destroy();
      };
      if (decoder) pipeline(response, decoder, scrubber, res, done);
      else pipeline(response, scrubber, res, done);
    });
    upstream.setTimeout(60_000, () => upstream.destroy(new Error("Upstream request timed out.")));
    upstream.on("error", () => {
      agent?.destroy();
      if (!res.headersSent) res.writeHead(502).end("Credential proxy could not reach the destination.");
      else res.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      upstream.destroy();
      agent?.destroy();
    });
    if (injected.used.length) options.used?.(injected.used);
    req.pipe(upstream);
  } catch {
    res.writeHead(403).end("Credential proxy refused this destination or credential header.");
  }
}
