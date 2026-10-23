import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readUiBuild(path = join(import.meta.dir, "../../../ui/dist/index.html")): string | null {
  try {
    return /<meta name="bureau-ui-build" content="([a-f0-9]{24})"/.exec(readFileSync(path, "utf8"))?.[1] ?? null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
