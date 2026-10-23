import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

export function compressUi(root: string) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) compressUi(path);
    else if (entry.isFile() && /\.(js|css|html|svg|json)$/.test(entry.name)) {
      const data = readFileSync(path);
      for (const [suffix, compressed] of [
        ["br", brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })],
        ["gz", gzipSync(data, { level: 6 })],
      ] as const) {
        writeFileSync(`${path}.${suffix}`, compressed);
      }
    }
  }
}
