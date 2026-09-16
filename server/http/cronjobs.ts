import type { AuthResult } from "../auth/auth-middleware.ts";
import { InvalidModelFamilyError } from "../agent-validators.ts";
import * as CronjobManager from "../cronjobs/index.ts";
import { saveRecentCwd } from "../persistence.ts";
import { handleCronjobRunAffordanceRequest } from "./cronjob-run-affordances.ts";
import { cronjobCallerOrError, cronjobCorsHeaders, cronjobRouteParts, jsonError, parseCronjobChanges, parseCronjobCreate, readJson, validateCwdForRequest } from "./cronjob-route-helpers.ts";

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
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (req.method === "PUT" && url.pathname === "/api/cron-prompt") {
    if (auth?.kind !== "ok") return new Response(JSON.stringify({ error: "authenticated browser session required" }), { status: 401, headers: cronjobCorsHeaders });
    if (auth.session.role !== "owner") return new Response(JSON.stringify({ error: "owner access required" }), { status: 403, headers: cronjobCorsHeaders });
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: cronjobCorsHeaders });
    }
    const value = typeof body.value === "string" && body.value.trim() ? body.value : null;
    CronjobManager.setCronjobsPrompt(value);
    return new Response(null, { status: 204, headers: cronjobCorsHeaders });
  }

  if (req.method === "GET" && url.pathname === "/api/cron-runs") {
    return new Response(
      JSON.stringify({
        jobs: CronjobManager.getAllRunsByJob().map((j) => ({ cronjobId: j.jobId, runs: j.runs })),
      }),
      { headers: cronjobCorsHeaders },
    );
  }

  const parts = cronjobRouteParts(url.pathname);
  if (!parts) return null;

  // ["cronjobs"] | ["cronjobs", id] | ["cronjobs", id, "runs"] | ["cronjobs", id, "runs", runId]
  const cronjobs = CronjobManager.listCronjobs();

  // GET /cronjobs
  if (req.method === "GET" && parts.length === 1) {
    return new Response(JSON.stringify(cronjobs), { headers: cronjobCorsHeaders });
  }

  const jobId = parts[1];
  if (req.method === "POST" && parts.length === 1) {
    const caller = cronjobCallerOrError(req, auth);
    if (caller instanceof Response) return caller;
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const parsed = parseCronjobCreate(body);
    if (!parsed.ok) return jsonError(400, parsed.error);
    const cwdError = validateCwdForRequest(parsed.draft.cwd);
    if (cwdError) return jsonError(400, cwdError);
    saveRecentCwd(parsed.draft.cwd);
    try {
      const cronjob = CronjobManager.addCronjob({
        ...parsed.draft,
        username: caller.session.username,
        userId: caller.session.userId,
      });
      return new Response(JSON.stringify(cronjob), { status: 201, headers: cronjobCorsHeaders });
    } catch (err) {
      if (err instanceof InvalidModelFamilyError) return jsonError(422, err.message);
      throw err;
    }
  }

  const cronjob = cronjobs.find((c) => c.id === jobId);
  if (!cronjob) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: cronjobCorsHeaders });

  // GET /cronjobs/:id
  if (req.method === "GET" && parts.length === 2) {
    return new Response(JSON.stringify(cronjob), { headers: cronjobCorsHeaders });
  }
  // PATCH /cronjobs/:id
  if (req.method === "PATCH" && parts.length === 2) {
    const caller = cronjobCallerOrError(req, auth, cronjob);
    if (caller instanceof Response) return caller;
    const body = await readJson(req);
    if (body instanceof Response) return body;
    if (body.cwd !== undefined) {
      if (typeof body.cwd !== "string") return jsonError(400, "cwd must be a string");
      const cwdError = validateCwdForRequest(body.cwd);
      if (cwdError) return jsonError(400, cwdError);
      saveRecentCwd(body.cwd);
    }
    const parsed = parseCronjobChanges(body);
    if (!parsed.ok) return jsonError(400, parsed.error);
    try {
      const updated = CronjobManager.updateCronjob(jobId, parsed.changes);
      return updated ? new Response(JSON.stringify(updated), { headers: cronjobCorsHeaders }) : jsonError(404, "not found");
    } catch (err) {
      if (err instanceof InvalidModelFamilyError) return jsonError(422, err.message);
      throw err;
    }
  }
  // DELETE /cronjobs/:id
  if (req.method === "DELETE" && parts.length === 2) {
    const caller = cronjobCallerOrError(req, auth, cronjob);
    if (caller instanceof Response) return caller;
    return CronjobManager.deleteCronjob(jobId) ? new Response(null, { status: 204, headers: cronjobCorsHeaders }) : jsonError(404, "not found");
  }
  // GET /cronjobs/:id/runs
  if (req.method === "GET" && parts[2] === "runs" && parts.length === 3) {
    const runs = CronjobManager.getRunsForCronjob(jobId);
    return new Response(JSON.stringify(runs), { headers: cronjobCorsHeaders });
  }
  // POST /cronjobs/:id/runs
  if (req.method === "POST" && parts[2] === "runs" && parts.length === 3) {
    const caller = cronjobCallerOrError(req, auth, cronjob);
    if (caller instanceof Response) return caller;
    const run = CronjobManager.runCronjobNow(jobId, caller.session.username);
    return run ? new Response(JSON.stringify({ runId: run.id }), { headers: cronjobCorsHeaders }) : jsonError(404, "not found");
  }
  // GET /cronjobs/:id/runs/:runId
  if (req.method === "GET" && parts[2] === "runs" && parts.length === 4) {
    const { run, entries } = CronjobManager.getRunTranscript(jobId, parts[3]);
    if (!run) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: cronjobCorsHeaders });
    return new Response(JSON.stringify({ run, entries }), { headers: cronjobCorsHeaders });
  }
  // POST /cronjobs/:id/runs/:runId/messages
  if (req.method === "POST" && parts[2] === "runs" && parts.length === 5 && parts[4] === "messages") {
    const caller = cronjobCallerOrError(req, auth, cronjob);
    if (caller instanceof Response) return caller;
    const runId = parts[3]!;
    if (!CronjobManager.getRunTranscript(jobId, runId).run) return jsonError(404, "not found");
    const body = await readJson(req);
    if (body instanceof Response) return body;
    if (typeof body.text !== "string" || !body.text.trim()) return jsonError(400, "text is required");
    const messageId = crypto.randomUUID();
    void CronjobManager.sendRunMessage(jobId, runId, body.text, caller.session.username);
    return new Response(JSON.stringify({ messageId }), { headers: cronjobCorsHeaders });
  }
  // PATCH /cronjobs/:id/runs/:runId/messages/:logEntryId
  if (req.method === "PATCH" && parts[2] === "runs" && parts.length === 6 && parts[4] === "messages") {
    const caller = cronjobCallerOrError(req, auth, cronjob);
    if (caller instanceof Response) return caller;
    const runId = parts[3]!;
    if (!CronjobManager.getRunTranscript(jobId, runId).run) return jsonError(404, "not found");
    const body = await readJson(req);
    if (body instanceof Response) return body;
    if (typeof body.newText !== "string" || !body.newText.trim()) return jsonError(400, "newText is required");
    const messageId = crypto.randomUUID();
    void CronjobManager.editRunMessage(jobId, runId, parts[5]!, body.newText, caller.session.username);
    return new Response(JSON.stringify({ messageId }), { headers: cronjobCorsHeaders });
  }
  const affordanceResponse = await handleCronjobRunAffordanceRequest(req, parts, jobId);
  if (affordanceResponse) return affordanceResponse;
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: cronjobCorsHeaders });
  }
  return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: cronjobCorsHeaders });
}
