import type { AuthResult } from "../auth/auth-middleware.ts";
import { agents } from "../agents/state.ts";
import { getBackupStatus } from "../backup.ts";
import { BUREAU_DIR, LOGS_DIR } from "../persistence/paths.ts";
import { loadSessionsMap } from "../persistence/logs/sessions.ts";
import { applyPrune, planPrune, type PruneDeps } from "../storage/prune.ts";
import { measureStorage } from "../storage-usage.ts";
import type { PrunePolicy, PruneTarget } from "../../shared/storage-types.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export interface StorageRouteDeps {
  stateRoot: string;
  logsDir: string;
  backupDir: string | null;
  now: () => number;
  pruneDeps: () => PruneDeps;
}

function defaultDeps(): StorageRouteDeps {
  return {
    stateRoot: BUREAU_DIR,
    logsDir: LOGS_DIR,
    backupDir: getBackupStatus().backupDir,
    now: Date.now,
    pruneDeps: () => ({
      logsDir: LOGS_DIR,
      now: Date.now(),
      activeSessionIds: new Set([...agents.values()].map((agent) => agent.sessionId).filter((id): id is string => id !== null)),
      loadSessionsMap,
      queuedAttachments: (agentId) => new Set((agents.get(agentId)?.messageQueue ?? []).flatMap((message) => message.attachments?.map((attachment) => attachment.filename) ?? [])),
    }),
  };
}

export async function handleStorageRequest(req: Request, url: URL, auth: AuthResult | undefined, routeDeps: StorageRouteDeps = defaultDeps()): Promise<Response | null> {
  if (url.pathname !== "/api/storage/usage" && url.pathname !== "/api/storage/prune") return null;
  if (auth?.kind !== "ok") return jsonError(401, "unauthenticated");
  if (auth.session.role !== "owner") return jsonError(403, "owner access required");

  if (url.pathname === "/api/storage/usage") {
    if (req.method !== "GET") return jsonError(405, "method not allowed");
    return json(measureStorage({ stateRoot: routeDeps.stateRoot, backupDir: routeDeps.backupDir }));
  }

  if (req.method !== "POST") return jsonError(405, "method not allowed");
  const parsed = await parsePruneBody(req);
  if ("error" in parsed) return jsonError(400, parsed.error);

  const keepPerAgent = parsed.keepPerAgent ?? 0;
  if (parsed.apply && parsed.target === "transcripts" && parsed.keepPerAgent === undefined) {
    return jsonError(400, "keepPerAgent is required when applying transcript pruning");
  }
  const deps = routeDeps.pruneDeps();
  const plan = planPrune(parsed.target, { olderThanDays: parsed.olderThanDays, keepPerAgent }, deps);
  const applied = parsed.apply ? applyPrune(plan, deps) : null;
  return json({ plan, applied });
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: JSON_HEADERS });
}

async function parsePruneBody(req: Request): Promise<PrunePolicy | { error: string }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: "invalid JSON body" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "body must be an object" };
  const record = body as Record<string, unknown>;
  if (record.target !== "transcripts" && record.target !== "attachments") return { error: "target must be transcripts or attachments" };
  if (!Number.isInteger(record.olderThanDays) || (record.olderThanDays as number) <= 0) return { error: "olderThanDays must be a positive integer" };
  if (record.keepPerAgent !== undefined && (!Number.isInteger(record.keepPerAgent) || (record.keepPerAgent as number) < 0)) return { error: "keepPerAgent must be a nonnegative integer" };
  if (record.apply !== undefined && typeof record.apply !== "boolean") return { error: "apply must be a boolean" };
  return {
    target: record.target as PruneTarget,
    olderThanDays: record.olderThanDays as number,
    ...(record.keepPerAgent !== undefined ? { keepPerAgent: record.keepPerAgent as number } : {}),
    ...(record.apply !== undefined ? { apply: record.apply as boolean } : {}),
  };
}
