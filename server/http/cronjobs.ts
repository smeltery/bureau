import { readBearerToken } from "../agents/tokens.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import * as CronjobManager from "../cronjobs/index.ts";
import { resolveRunToken } from "../cronjobs/tokens.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

/**
 * Handle every /cronjobs and /api/cronjobs request. Returns null for unrelated
 * URLs so the caller can fall through to the next router.
 */
export async function handleCronjobsRequest(req: Request, url: URL, auth?: AuthResult): Promise<Response | null> {
  // CORS preflight
  if (req.method === "OPTIONS" && (url.pathname.startsWith("/cronjobs") || url.pathname.startsWith("/api/cronjobs") || url.pathname === "/api/cron-runs" || url.pathname === "/api/cron-prompt")) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (req.method === "PUT" && url.pathname === "/api/cron-prompt") {
    if (auth?.kind !== "ok") return new Response(JSON.stringify({ error: "authenticated browser session required" }), { status: 401, headers: corsHeaders });
    if (auth.session.role !== "owner") return new Response(JSON.stringify({ error: "owner access required" }), { status: 403, headers: corsHeaders });
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: corsHeaders });
    }
    const value = typeof body.value === "string" && body.value.trim() ? body.value : null;
    CronjobManager.setCronjobsPrompt(value);
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method === "GET" && url.pathname === "/api/cron-runs") {
    return new Response(
      JSON.stringify({
        jobs: CronjobManager.getAllRunsByJob().map((j) => ({ cronjobId: j.jobId, runs: j.runs })),
      }),
      { headers: corsHeaders },
    );
  }

  const parts = cronjobRouteParts(url.pathname);
  if (!parts) return null;

  // ["cronjobs"] | ["cronjobs", id] | ["cronjobs", id, "runs"] | ["cronjobs", id, "runs", runId]
  const cronjobs = CronjobManager.listCronjobs();

  // GET /cronjobs
  if (req.method === "GET" && parts.length === 1) {
    return new Response(JSON.stringify(cronjobs), { headers: corsHeaders });
  }

  const jobId = parts[1];
  const cronjob = cronjobs.find((c) => c.id === jobId);
  if (!cronjob) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });

  // GET /cronjobs/:id
  if (req.method === "GET" && parts.length === 2) {
    return new Response(JSON.stringify(cronjob), { headers: corsHeaders });
  }
  // GET /cronjobs/:id/runs
  if (req.method === "GET" && parts[2] === "runs" && parts.length === 3) {
    const runs = CronjobManager.getRunsForCronjob(jobId);
    return new Response(JSON.stringify(runs), { headers: corsHeaders });
  }
  // GET /cronjobs/:id/runs/:runId
  if (req.method === "GET" && parts[2] === "runs" && parts.length === 4) {
    const { run, entries } = CronjobManager.getRunTranscript(jobId, parts[3]);
    if (!run) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    return new Response(JSON.stringify({ run, entries }), { headers: corsHeaders });
  }
  // POST /cronjobs/:id/runs/:runId/read-file
  if (req.method === "POST" && parts[2] === "runs" && parts.length === 5 && parts[4] === "read-file") {
    const denied = requireRunBearer(req, jobId, parts[3]!);
    if (denied) return denied;
    let path: string | undefined;
    try {
      const body = (await req.json()) as Record<string, unknown> | null;
      if (body && typeof body.path === "string") path = body.path;
    } catch {}
    if (!path) return new Response(JSON.stringify({ error: "missing path" }), { status: 400, headers: corsHeaders });
    const result = CronjobManager.emitRunReadFile(jobId, parts[3]!, path);
    if (!result.ok) return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }
  // POST /cronjobs/:id/runs/:runId/diff
  if (req.method === "POST" && parts[2] === "runs" && parts.length === 5 && parts[4] === "diff") {
    const denied = requireRunBearer(req, jobId, parts[3]!);
    if (denied) return denied;
    let dir: string | undefined;
    let commit: string | undefined;
    try {
      const body = (await req.json()) as Record<string, unknown> | null;
      if (body && typeof body.dir === "string") dir = body.dir;
      if (body && typeof body.commit === "string") commit = body.commit;
    } catch {}
    const result = CronjobManager.emitRunDiff(jobId, parts[3]!, dir, commit);
    if (!result.ok) return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
}

function requireRunBearer(req: Request, jobId: string, runId: string): Response | null {
  const identity = resolveRunToken(readBearerToken(req));
  if (!identity) {
    return new Response(JSON.stringify({ error: "missing or invalid bearer token" }), { status: 401, headers: corsHeaders });
  }
  if (identity.cronjobId !== jobId || identity.runId !== runId) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
  }
  return null;
}

function cronjobRouteParts(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "cronjobs") return parts;
  if (parts[0] === "api" && parts[1] === "cronjobs") return parts.slice(1);
  return null;
}
