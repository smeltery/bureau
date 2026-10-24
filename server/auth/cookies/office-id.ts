import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";

/** Public namespace only; possession of this identifier grants no access. */
export function readOrCreateOfficeId(path: string): string {
  try {
    const value = readFileSync(path, "utf8").trim();
    if (/^[a-f0-9]{12}$/.test(value)) return value;
    const quarantine = `${path}.invalid-${Date.now()}-${randomBytes(4).toString("hex")}`;
    renameSync(path, quarantine);
    console.error(`[auth] Invalid office identifier preserved at ${quarantine}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const id = randomBytes(6).toString("hex");
  try {
    writeFileSync(path, `${id}\n`, { mode: 0o600, flag: "wx" });
    return id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = readFileSync(path, "utf8").trim();
    if (!/^[a-f0-9]{12}$/.test(existing)) throw new Error("Concurrent office identifier creation is incomplete; restart the office.");
    return existing;
  }
}
