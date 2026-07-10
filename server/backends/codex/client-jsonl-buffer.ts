export class JsonlFrameBuffer {
  private buffer = "";

  push(chunk: string, onLine: (line: string) => void): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const trimmed = line.trim();
      if (trimmed) onLine(trimmed);
    }
  }
}
