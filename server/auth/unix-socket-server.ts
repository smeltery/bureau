import { dlopen, ptr } from "bun:ffi";
import { readDarwinPeerCredentials } from "../backends/opencode/darwin-libsystem.ts";

export interface ParsedRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: Buffer;
}

export function parseHttpRequest(buffer: Buffer, maxBytes: number): ParsedRequest | null {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd < 0) return null;
  const lines = buffer.subarray(0, headerEnd).toString("utf8").split("\r\n");
  const match = /^(GET|POST|PATCH|PUT|DELETE) ([^ ]+) HTTP\/1\.[01]$/.exec(lines.shift() ?? "");
  if (!match || /[\r\n]/.test(match[2])) throw new Error("Invalid socket request.");
  const headers = new Headers();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) throw new Error("Invalid socket header.");
    headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const lengthText = headers.get("content-length") ?? "0";
  if (!/^\d+$/.test(lengthText)) throw new Error("Invalid content length.");
  const length = Number(lengthText);
  if (length > maxBytes) throw new Error("Socket body is too large.");
  const bodyStart = headerEnd + 4;
  if (buffer.length < bodyStart + length) return null;
  const url = new URL(match[2], "http://bureau");
  if (url.origin !== "http://bureau") throw new Error("Socket host is fixed.");
  return { method: match[1], url, headers, body: buffer.subarray(bodyStart, bodyStart + length) };
}

export function httpResponse(status: number, body: string | Buffer, contentType = "text/plain; charset=utf-8"): Buffer {
  const safeBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return Buffer.concat([
    Buffer.from(`HTTP/1.1 ${status} ${status >= 200 && status < 300 ? "OK" : "Error"}\r\nContent-Type: ${contentType}\r\nContent-Length: ${safeBody.length}\r\nConnection: close\r\n\r\n`),
    safeBody,
  ]);
}

const LIBC_SYMBOLS = {
  getsockopt: { args: ["i32", "i32", "i32", "ptr", "ptr"], returns: "i32" },
} as const;

function openLibc(candidate: string) {
  return dlopen(candidate, LIBC_SYMBOLS);
}

let libc: ReturnType<typeof openLibc> | null = null;
let libcLoadAttempted = false;

function loadLibc(): ReturnType<typeof openLibc> | null {
  if (libcLoadAttempted) return libc;
  libcLoadAttempted = true;
  for (const candidate of ["libc.so.6", process.arch === "arm64" ? "libc.musl-aarch64.so.1" : "libc.musl-x86_64.so.1"]) {
    try {
      libc = openLibc(candidate);
      return libc;
    } catch {}
  }
  console.error("[unix-socket] SO_PEERCRED is unavailable; sockets that check the caller refuse every connection.");
  return null;
}

export function socketFileDescriptor(socket: Bun.Socket<unknown>): number | null {
  const fd: unknown = Reflect.get(socket, "fd");
  return typeof fd === "number" && Number.isInteger(fd) && fd >= 0 ? fd : null;
}

export function readPeerCredentials(fd: number): { pid: number; uid: number } | null {
  if (process.platform === "darwin") return readDarwinPeerCredentials(fd);
  if (process.platform !== "linux") return null;
  const loaded = loadLibc();
  if (!loaded) return null;
  const credential = new Uint32Array(3);
  const length = new Uint32Array([credential.byteLength]);
  try {
    const result = loaded.symbols.getsockopt(fd, 1, 17, ptr(credential), ptr(length));
    if (result !== 0 || length[0] !== credential.byteLength) return null;
    return { pid: credential[0], uid: credential[1] };
  } catch {
    return null;
  }
}
