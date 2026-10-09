import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isSensitiveFile } from "../agents/session/safety/secrets.ts";

/** Read a bounded regular file without waiting on FIFOs or exposing secret paths. */
export function readTransferFile(path: string, limit: number, errorMessage: string): Buffer {
  let fd: number | undefined;
  try {
    const resolved = realpathSync(path);
    if (isSensitiveFile(path) || isSensitiveFile(resolved)) throw new Error("protected path");
    fd = openSync(resolved, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error("invalid file");
    // Read at most one byte beyond the limit, even if the file grows after stat.
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > limit) throw new Error("file too large");
    return bytes.subarray(0, length);
  } catch {
    throw new Error(errorMessage);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
