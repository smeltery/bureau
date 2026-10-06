import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_LICENSE_FILES } from "./license-notices.mjs";

// Store-only ZIP keeps extension packaging independent of system zip tools.
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const root = join(import.meta.dir, "..");
const chunks: Buffer[] = [],
  directory: Buffer[] = [];
let offset = 0;
const extensionFiles = (await readdir(join(root, "browser-extension")))
  .filter((filename) => /\.(js|json|html|css)$/.test(filename))
  .map((filename) => ({ filename, source: join(root, "browser-extension", filename) }));
const noticeFiles = PROJECT_LICENSE_FILES.map((filename) => ({ filename, source: join(root, filename) }));
for (const { filename, source } of [...extensionFiles, ...noticeFiles].sort((a, b) =>
  a.filename.localeCompare(b.filename),
)) {
  const name = Buffer.from(filename),
    data = await readFile(source);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  chunks.push(header, name, data);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50);
  entry.writeUInt16LE(20, 4);
  header.copy(entry, 6, 4, 30);
  entry.writeUInt32LE(offset, 42);
  directory.push(entry, name);
  offset += header.length + name.length + data.length;
}
const index = Buffer.concat(directory),
  end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(directory.length / 2, 8);
end.writeUInt16LE(directory.length / 2, 10);
end.writeUInt32LE(index.length, 12);
end.writeUInt32LE(offset, 16);
await mkdir(join(root, "ui/dist"), { recursive: true });
await writeFile(join(root, "ui/dist/bureau-browser.zip"), Buffer.concat([...chunks, index, end]));
