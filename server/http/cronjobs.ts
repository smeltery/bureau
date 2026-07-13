import type { AuthOk, AuthResult } from "../auth/auth-middleware.ts";
import * as CronjobManager from "../cronjobs/index.ts";
import * as AgentManager from "../agent-manager.ts";
import { saveRecentCwd } from "../persistence.ts";
import type { Cronjob } from "../../shared/types.ts";
import { handleCronjobRunAffordanceRequest } from "./cronjob-run-affordances.ts";

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
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, PUT, OPTIONS",
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
  if (req.method === "POST" && parts.length === 1) {
    const caller = browserSessionOrError(auth);
    if (caller instanceof Response) return caller;
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const malformed = validateCronjobCreate(body);
    if (malformed) return jsonError(400, malformed);
    const cwdError = validateCwdForRequest(String(body.cwd));
    if (cwdError) return jsonError(400, cwdError);
    saveRecentCwd(String(body.cwd));
    const cronjob = CronjobManager.addCronjob({
      name: String(body.name),
      schedule: body.schedule as Cronjob["schedule"],
      prompt: String(body.prompt),
      cwd: String(body.cwd),
      agentType: typeof body.agentType === "string" ? (body.agentType as Cronjob["agentType"]) : undefined,
      modelFamily: String(body.modelFamily),
      effort: typeof body.effort === "string" ? (body.effort as Cronjob["effort"]) : undefined,
      permissionMode: body.permissionMode as Cronjob["permissionMode"],
      codexSandbox: typeof body.codexSandbox === "string" ? (body.codexSandbox as Cronjob["codexSandbox"]) : undefined,
      username: caller.session.username,
      userId: caller.session.userId,
    });
    return new Response(JSON.stringify(cronjob), { status: 201, headers: corsHeaders });
  }

  const cronjob = cronjobs.find((c) => c.id === jobId);
  if (!cronjob) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });

  // GET /cronjobs/:id
  if (req.method === "GET" && parts.length === 2) {
    return new Response(JSON.stringify(cronjob), { headers: corsHeaders });
  }
  // PATCH /cronjobs/:id
  if (req.method === "PATCH" && parts.length === 2) {
    const caller = cronjobOwnerOrError(auth, cronjob);
    if (caller instanceof Response) return caller;
    const body = await readJson(req);
    if (body instanceof Response) return body;
    if (body.cwd !== undefined) {
      if (typeof body.cwd !== "string") return jsonError(400, "cwd must be a string");
      const cwdError = validateCwdForRequest(body.cwd);
      if (cwdError) return jsonError(400, cwdError);
      saveRecentCwd(body.cwd);
    }
    const updated = CronjobManager.updateCronjob(jobId, pickCronjobChanges(body));
    return updated ? new Response(JSON.stringify(updated), { headers: corsHeaders }) : jsonError(404, "not found");
  }
  // DELETE /cronjobs/:id
  if (req.method === "DELETE" && parts.length === 2) {
    const caller = cronjobOwnerOrError(auth, cronjob);
    if (caller instanceof Response) return caller;
    return CronjobManager.deleteCronjob(jobId) ? new Response(null, { status: 204, headers: corsHeaders }) : jsonError(404, "not found");
  }
  // GET /cronjobs/:id/runs
  if (req.method === "GET" && parts[2] === "runs" && parts.length === 3) {
    const runs = CronjobManager.getRunsForCronjob(jobId);
    return new Response(JSON.stringify(runs), { headers: corsHeaders });
  }
  // POST /cronjobs/:id/runs
  if (req.method === "POST" && parts[2] === "runs" && parts.length === 3) {
    const caller = cronjobOwnerOrError(auth, cronjob);
    if (caller instanceof Response) return caller;
    const run = CronjobManager.runCronjobNow(jobId, caller.session.username);
    return run ? new Response(JSON.stringify({ runId: run.id }), { headers: corsHeaders }) : jsonError(404, "not found");
  }
  // GET /cronjobs/:id/runs/:runId
  if (req.method === "GET" && parts[2] === "runs" && parts.length === 4) {
    const { run, entries } = CronjobManager.getRunTranscript(jobId, parts[3]);
    if (!run) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    return new Response(JSON.stringify({ run, entries }), { headers: corsHeaders });
  }
  // POST /cronjobs/:id/runs/:runId/messages
  if (req.method === "POST" && parts[2] === "runs" && parts.length === 5 && parts[4] === "messages") {
    const caller = cronjobOwnerOrError(auth, cronjob);
    if (caller instanceof Response) return caller;
    const runId = parts[3]!;
    if (!CronjobManager.getRunTranscript(jobId, runId).run) return jsonError(404, "not found");
    const body = await readJson(req);
    if (body instanceof Response) return body;
    if (typeof body.text !== "string" || !body.text.trim()) return jsonError(400, "text is required");
    const messageId = crypto.randomUUID();
    void CronjobManager.sendRunMessage(jobId, runId, body.text, caller.session.username);
    return new Response(JSON.stringify({ messageId }), { headers: corsHeaders });
  }
  // PATCH /cronjobs/:id/runs/:runId/messages/:logEntryId
  if (req.method === "PATCH" && parts[2] === "runs" && parts.length === 6 && parts[4] === "messages") {
    const caller = cronjobOwnerOrError(auth, cronjob);
    if (caller instanceof Response) return caller;
    const runId = parts[3]!;
    if (!CronjobManager.getRunTranscript(jobId, runId).run) return jsonError(404, "not found");
    const body = await readJson(req);
    if (body instanceof Response) return body;
    if (typeof body.newText !== "string" || !body.newText.trim()) return jsonError(400, "newText is required");
    const messageId = crypto.randomUUID();
    void CronjobManager.editRunMessage(jobId, runId, parts[5]!, body.newText, caller.session.username);
    return new Response(JSON.stringify({ messageId }), { headers: corsHeaders });
  }
  const affordanceResponse = await handleCronjobRunAffordanceRequest(req, parts, jobId);
  if (affordanceResponse) return affordanceResponse;
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
}

function browserSessionOrError(auth: AuthResult | undefined): AuthOk | Response {
  return auth?.kind === "ok" ? auth : jsonError(401, "authenticated browser session required");
}

function cronjobOwnerOrError(auth: AuthResult | undefined, cronjob: Cronjob): AuthOk | Response {
  const caller = browserSessionOrError(auth);
  if (caller instanceof Response) return caller;
  if (caller.session.role === "owner" || cronjob.userId === caller.session.userId) return caller;
  return jsonError(403, "owner access required");
}

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "invalid JSON");
  }
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: corsHeaders });
}

function validateCwdForRequest(cwd: string): string | null {
  try {
    AgentManager.validateCwd(cwd);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "invalid directory";
  }
}

function validateCronjobCreate(body: Record<string, unknown>): string | null {
  if (typeof body.name !== "string" || !body.name.trim()) return "name is required";
  if (typeof body.prompt !== "string") return "prompt is required";
  if (typeof body.cwd !== "string" || !body.cwd.trim()) return "cwd is required";
  if (body.schedule === undefined || body.modelFamily === undefined) return "schedule and modelFamily are required";
  if (body.effort === undefined || body.permissionMode === undefined) return "effort and permissionMode are required";
  return null;
}

function pickCronjobChanges(body: Record<string, unknown>): Parameters<typeof CronjobManager.updateCronjob>[1] {
  const changes: Parameters<typeof CronjobManager.updateCronjob>[1] = {};
  if (typeof body.name === "string") changes.name = body.name;
  if (body.schedule !== undefined) changes.schedule = body.schedule as Cronjob["schedule"];
  if (typeof body.prompt === "string") changes.prompt = body.prompt;
  if (typeof body.cwd === "string") changes.cwd = body.cwd;
  if (typeof body.modelFamily === "string") changes.modelFamily = body.modelFamily;
  if (typeof body.effort === "string") changes.effort = body.effort as Cronjob["effort"];
  if (typeof body.permissionMode === "string") changes.permissionMode = body.permissionMode as Cronjob["permissionMode"];
  if (typeof body.codexSandbox === "string") changes.codexSandbox = body.codexSandbox as Cronjob["codexSandbox"];
  if (typeof body.enabled === "boolean") changes.enabled = body.enabled;
  return changes;
}

function cronjobRouteParts(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "cronjobs") return parts;
  if (parts[0] === "api" && parts[1] === "cronjobs") return parts.slice(1);
  return null;
}
