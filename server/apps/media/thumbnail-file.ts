import { readTransferFile } from "../../file-access/transfer-file.ts";
import { THUMBNAIL_LIMIT } from "../thumbnails.ts";

export function readThumbnailFile(path: string): Buffer {
  return readTransferFile(path, THUMBNAIL_LIMIT, "path must name a readable, non-sensitive regular file of at most 1 MiB.");
}
