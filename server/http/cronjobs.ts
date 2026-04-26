import * as CronjobManager from "../cronjobs/index.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

/**
 * Handle every /cronjobs request. Returns null for any non-cronjobs URL so the
 * caller can fall through to the next router. Mutations are not exposed over
 * HTTP (mirroring tasks): they go through the WebSocket only.
 */
export async function handleCronjobsRequest(req: Request, url: URL): Promise<Response | null> {
  // CORS preflight
  if (req.method === "OPTIONS" && url.pathname.startsWith("/cronjobs")) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (!url.pathname.startsWith("/cronjobs")) return null;

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: corsHeaders });
  }

  // ["cronjobs"] | ["cronjobs", id] | ["cronjobs", id, "runs"] | ["cronjobs", id, "runs", runId]
  const parts = url.pathname.split("/").filter(Boolean);
  const cronjobs = CronjobManager.listCronjobs();

  // GET /cronjobs
  if (parts.length === 1) {
    return new Response(JSON.stringify(cronjobs), { headers: corsHeaders });
  }

  const jobId = parts[1];
  const cronjob = cronjobs.find((c) => c.id === jobId);
  if (!cronjob) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });

  // GET /cronjobs/:id
  if (parts.length === 2) {
    return new Response(JSON.stringify(cronjob), { headers: corsHeaders });
  }
  // GET /cronjobs/:id/runs
  if (parts[2] === "runs" && parts.length === 3) {
    const runs = CronjobManager.getRunsForCronjob(jobId);
    return new Response(JSON.stringify(runs), { headers: corsHeaders });
  }
  // GET /cronjobs/:id/runs/:runId
  if (parts[2] === "runs" && parts.length === 4) {
    const { run, entries } = CronjobManager.getRunTranscript(jobId, parts[3]);
    if (!run) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    return new Response(JSON.stringify({ run, entries }), { headers: corsHeaders });
  }
  return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
}
