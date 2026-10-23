import { lstatSync, readFileSync, utimesSync, type Stats } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { CompressionPlan, CompressionResult } from "../../shared/storage-types.ts";
import { listTranscripts, publishCompressed } from "../persistence/logs/transcript-files.ts";
import { listAgentDirs } from "./prune.ts";

const compress = promisify(gzip);
export interface CompressionDeps {
  logsDir: string;
  now: number;
  isActive(sessionId: string): boolean;
  canApply?: () => boolean;
  compress?: (bytes: Buffer) => Promise<Buffer>;
}

export function planCompression(olderThanDays: number, deps: CompressionDeps): CompressionPlan {
  const plan: CompressionPlan = { olderThanDays, candidates: [], bytes: 0, skipped: [] };
  for (const agentId of listAgentDirs(deps.logsDir)) {
    for (const file of listTranscripts(join(deps.logsDir, agentId))) {
      if (file.compressed) continue;
      const reason = deps.isActive(file.sessionId) ? "active-session" : file.mtimeMs > deps.now - olderThanDays * 86_400_000 ? "too-recent" : null;
      if (reason) {
        let skipped = plan.skipped.find((row) => row.reason === reason);
        if (!skipped) {
          skipped = { reason, count: 0, bytes: 0 };
          plan.skipped.push(skipped);
        }
        skipped.count++;
        skipped.bytes += file.bytes;
      } else {
        plan.candidates.push({ path: join(agentId, file.name), agentId, sessionId: file.sessionId, bytes: file.bytes, mtimeMs: file.mtimeMs });
        plan.bytes += file.bytes;
      }
    }
  }
  return plan;
}

function sameFile(before: Stats, after: Stats): boolean {
  return after.isFile() && before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

export async function applyCompression(plan: CompressionPlan, deps: CompressionDeps): Promise<CompressionResult> {
  const fresh = new Map(planCompression(plan.olderThanDays, deps).candidates.map((file) => [file.path, file]));
  const result: CompressionResult = { compressed: 0, bytesBefore: 0, bytesAfter: 0, refused: [] };
  for (const candidate of plan.candidates) {
    const file = fresh.get(candidate.path);
    const refuse = (reason: string) => result.refused.push({ path: candidate.path, reason });
    if (!file) {
      refuse("not-in-fresh-plan");
      continue;
    }
    if (candidate.bytes !== file.bytes || candidate.mtimeMs !== file.mtimeMs) {
      refuse("modified-since-plan");
      continue;
    }
    const path = join(deps.logsDir, file.path);
    const directory = dirname(path);
    try {
      if (deps.canApply && !deps.canApply()) {
        refuse("authorization-changed");
        continue;
      }
      const parent = lstatSync(directory);
      const before = lstatSync(path);
      if (!parent.isDirectory() || !before.isFile() || before.size !== file.bytes || before.mtimeMs !== file.mtimeMs) {
        refuse("modified-since-plan");
        continue;
      }
      const bytes = await (deps.compress ?? compress)(readFileSync(path));
      // No await from these rechecks through publication: an append/resume
      // cannot interleave with replacement in the server process.
      if (deps.canApply && !deps.canApply()) {
        refuse("authorization-changed");
        continue;
      }
      if (deps.isActive(file.sessionId)) {
        refuse("became-active-session");
        continue;
      }
      const currentParent = lstatSync(directory);
      if (!currentParent.isDirectory() || parent.ino !== currentParent.ino || parent.dev !== currentParent.dev || !sameFile(before, lstatSync(path))) {
        refuse("modified-since-plan");
        continue;
      }
      if (bytes.length >= before.size) {
        refuse("no-space-saved");
        continue;
      }
      publishCompressed(path, bytes, before.mtimeMs);
      // Directory mtime is the legacy killed-agent timestamp. Preserve the
      // value immediately before our synchronous changes, not before gzip.
      utimesSync(directory, currentParent.atimeMs / 1000, currentParent.mtimeMs / 1000);
      result.compressed++;
      result.bytesBefore += before.size;
      result.bytesAfter += bytes.length;
    } catch (error) {
      console.error("[storage] transcript compression failed:", error);
      refuse("compression-failed");
    }
  }
  return result;
}
