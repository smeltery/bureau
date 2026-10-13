export const OFFICE_BODY_LIMIT = 8 * 1024 * 1024;
const HEAD_LIMIT = 64 * 1024;

export interface OfficeRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: Buffer;
}

export class OfficeHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class OfficeRequestReader {
  private headBytes = Buffer.alloc(0);
  private head: Omit<OfficeRequest, "body"> | null = null;
  private length = 0;
  private received = 0;
  private chunks: Buffer[] = [];

  read(chunk: Buffer, admit: (head: Omit<OfficeRequest, "body">) => void): OfficeRequest | null {
    if (!this.head) {
      this.headBytes = Buffer.concat([this.headBytes, chunk]);
      const boundary = this.headBytes.indexOf("\r\n\r\n");
      if (boundary < 0) {
        if (this.headBytes.length > HEAD_LIMIT) throw new OfficeHttpError(413, "OpenCode office request head is too large.");
        return null;
      }
      if (boundary > HEAD_LIMIT) throw new OfficeHttpError(413, "OpenCode office request head is too large.");
      const lines = this.headBytes.subarray(0, boundary).toString("utf8").split("\r\n");
      const match = /^(GET|POST|PATCH|PUT|DELETE) (\/[^ ]*) HTTP\/1\.[01]$/.exec(lines.shift() ?? "");
      if (!match) throw new OfficeHttpError(400, "Invalid proxy request.");
      const headers = new Headers();
      for (const line of lines) {
        const colon = line.indexOf(":");
        if (colon <= 0 || /^[ \t]/.test(line)) throw new OfficeHttpError(400, "Invalid proxy header.");
        headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
      }
      if (headers.has("transfer-encoding")) throw new OfficeHttpError(411, "Send a Content-Length; chunked office requests are not supported.");
      const length = headers.get("content-length") ?? "0";
      if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) throw new OfficeHttpError(400, "Invalid content length.");
      this.length = Number(length);
      if (this.length > OFFICE_BODY_LIMIT) throw new OfficeHttpError(413, "OpenCode office request body exceeds 8 MiB.");
      const url = new URL(match[2]!, "http://bureau");
      if (url.origin !== "http://bureau") throw new OfficeHttpError(400, "Proxy host is fixed.");
      if (headers.has("expect") && headers.get("expect")?.toLowerCase() !== "100-continue") throw new OfficeHttpError(417, "Unsupported expectation.");
      this.head = { method: match[1]!, url, headers };
      admit(this.head);
      chunk = this.headBytes.subarray(boundary + 4);
      this.headBytes = Buffer.alloc(0);
    }
    this.received += chunk.length;
    if (this.received > this.length) throw new OfficeHttpError(400, "Unexpected bytes after the request body.");
    if (chunk.length) this.chunks.push(chunk);
    if (this.received < this.length) return null;
    return { ...this.head, body: Buffer.concat(this.chunks, this.length) };
  }
}

interface WritableSocket {
  write(data: Buffer): number;
  end(): unknown;
  terminate(): unknown;
}
export class OfficeResponseWriter {
  private queue: Buffer[] = [];
  private offset = 0;
  private finish = false;
  constructor(private readonly socket: WritableSocket) {}
  send(data: Buffer, finish = true): void {
    this.queue.push(data);
    this.finish = finish;
    this.drain();
  }
  drain(): void {
    while (this.queue.length) {
      const current = this.queue[0]!;
      const written = this.socket.write(current.subarray(this.offset));
      if (written < 0) {
        this.queue = [];
        this.socket.terminate();
        return;
      }
      this.offset += written;
      if (this.offset < current.length) return;
      this.queue.shift();
      this.offset = 0;
    }
    if (this.finish) {
      this.finish = false;
      this.socket.end();
    }
  }
}
