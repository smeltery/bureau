import { readBearerToken } from "../agents/tokens.ts";
import * as CronjobManager from "../cronjobs/index.ts";
import { resolveRunToken } from "../cronjobs/tokens.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export async function handleCronjobRunAffordanceRequest(req: Request, parts: string[], jobId: string): Promise<Response | null> {
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

  return null;
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
