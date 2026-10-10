import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { processIdentityMatches } from "../process-identity.ts";

type ProcessRecord = { pid: number; startTicks: string; machine: string };
function machine(): string {
  return process.platform === "linux" ? `${hostname()}:${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}` : hostname();
}
export function previousProfileProcess(profileDir: string): ProcessRecord | null {
  let record: ProcessRecord;
  try {
    record = JSON.parse(readFileSync(join(profileDir, "server.pid"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!Number.isSafeInteger(record.pid) || record.pid < 1 || typeof record.startTicks !== "string" || record.machine !== machine()) return null;
  return processIdentityMatches(record.pid, record.startTicks) ? record : null;
}
export function saveProfileProcess(profileDir: string, pid: number, startTicks: string | undefined): void {
  if (!startTicks) throw new Error("Cannot establish OpenCode process identity for durable profile supervision.");
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const path = join(profileDir, "server.pid");
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ pid, startTicks, machine: machine() }), { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
