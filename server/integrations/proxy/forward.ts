import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { Readable, pipeline } from "node:stream";
import { bypassProxy } from "./connect.ts";
import { injectCredentials, type ProxyCredential } from "./credentials.ts";
import { scrubBuffer, SecretScrubber, secretPatterns } from "./scrub.ts";

const hopHeaders = ["connection", "proxy-connection", "proxy-authorization", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"];
export interface ForwardOptions {
  proxyUrl?: string;
  noProxy?: string;
  // Test-only transport routing and roots; production always verifies the destination certificate.
  target?: (host: string, port: number) => { host: string; port: number };
  ca?: string;
  used?: (credentials: ProxyCredential[]) => void;
}
export function forwardRequest(req: IncomingMessage, res: ServerResponse, destination: URL, credentials: ProxyCredential[], options: ForwardOptions): void {
  void forward(req, res, destination, credentials, options);
}
async function forward(req: IncomingMessage, res: ServerResponse, destination: URL, credentials: ProxyCredential[], options: ForwardOptions): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const activity = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), 60_000);
    timer.unref();
  };
  let authorized = false;
  try {
    if (req.method === "CONNECT" || req.headers.upgrade) throw new Error("Nested tunnels are unavailable.");
    const host = destination.hostname;
    const incomingHost = req.headers.host?.toLowerCase();
    if (destination.protocol === "https:" && incomingHost !== host && incomingHost !== `${host}:443`) throw new Error("Proxy destination mismatch.");
    const sni = (req.socket as TLSSocket & { servername?: string }).servername;
    if (sni && sni !== host) throw new Error("Proxy TLS name mismatch.");
    const injected = injectCredentials(host, req.headers, credentials);
    const headers = new Headers();
    const connectionNames = String(req.headers.connection ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase());
    for (const [name, values] of Object.entries(injected.headers)) {
      if ([...hopHeaders, ...connectionNames, "host", "content-length", "accept-encoding"].includes(name)) continue;
      for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value);
    }
    headers.set("host", destination.host);
    headers.set("accept-encoding", "identity");
    authorized = true;
    const port = Number(destination.port || (destination.protocol === "https:" ? 443 : 80));
    const target = options.target?.(host, port);
    const requestUrl = new URL(destination);
    if (target) {
      requestUrl.hostname = target.host;
      requestUrl.port = String(target.port);
    }
    const proxy = options.proxyUrl && !bypassProxy(host, port, options.noProxy ?? "") ? options.proxyUrl : "";
    if (proxy && !["http:", "https:"].includes(new URL(proxy).protocol)) throw new Error("Unsupported company proxy protocol.");
    req.on("aborted", () => controller.abort());
    res.on("close", () => {
      clearTimeout(timer);
      controller.abort();
    });
    req.on("data", activity);
    activity();
    if (injected.used.length) options.used?.(injected.used);
    const response = await fetch(requestUrl, {
      method: req.method,
      headers,
      ...(req.method === "GET" || req.method === "HEAD" ? {} : { body: Readable.toWeb(req) as unknown as ReadableStream<Uint8Array> }),
      proxy,
      tls: { serverName: host, ...(options.ca ? { ca: options.ca } : {}) },
      redirect: "manual",
      decompress: false,
      signal: controller.signal,
    });
    const patterns = secretPatterns(credentials.map((credential) => credential.secret.value));
    const encoding = response.headers.get("content-encoding")?.toLowerCase();
    const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : null;
    if (encoding && encoding !== "identity" && !decoder) throw new Error("Unsupported response encoding.");
    const responseConnectionNames = (response.headers.get("connection") ?? "").split(",").map((value) => value.trim().toLowerCase());
    for (const [name, value] of response.headers) {
      if ([...hopHeaders, ...responseConnectionNames, "content-length", "content-encoding", "set-cookie"].includes(name)) continue;
      res.setHeader(name, scrubBuffer(Buffer.from(value), patterns).toString());
    }
    const cookies = response.headers.getSetCookie().map((value) => scrubBuffer(Buffer.from(value), patterns).toString());
    if (cookies.length) res.setHeader("set-cookie", cookies);
    res.writeHead(response.status);
    if (!response.body) {
      clearTimeout(timer);
      res.end();
      return;
    }
    const source = Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    source.on("data", activity);
    const scrubber = new SecretScrubber(patterns);
    const done = (error: NodeJS.ErrnoException | null) => {
      clearTimeout(timer);
      if (error) {
        controller.abort();
        res.destroy();
      }
    };
    if (decoder) pipeline(source, decoder, scrubber, res, done);
    else pipeline(source, scrubber, res, done);
  } catch {
    clearTimeout(timer);
    controller.abort();
    if (res.headersSent) res.destroy();
    else res.writeHead(authorized ? 502 : 403).end(authorized ? "Credential proxy could not reach the destination." : "Credential proxy refused this destination or credential header.");
  }
}
