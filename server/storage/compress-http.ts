import type { AuthResult } from "../auth/auth-middleware.ts";
import { agents } from "../agents/state.ts";
import { LOGS_DIR } from "../persistence/paths.ts";
import { getUserById } from "../users.ts";
import { applyCompression, planCompression, type CompressionDeps } from "./compress.ts";

let applying = false;
export async function handleCompressionRequest(req: Request, auth: AuthResult | undefined): Promise<Response> {
  if (auth?.kind !== "ok") return Response.json({ error: "browser session required" }, { status: 401 });
  const isOwner = () => getUserById(auth.session.userId)?.role === "owner";
  if (!isOwner()) return Response.json({ error: "owner access required" }, { status: 403 });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "body must be an object" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !["olderThanDays", "apply"].includes(key)) ||
    !Number.isSafeInteger(input.olderThanDays) ||
    (input.olderThanDays as number) < 1 ||
    (input.olderThanDays as number) > 36500 ||
    (input.apply !== undefined && typeof input.apply !== "boolean")
  )
    return Response.json({ error: "olderThanDays must be an integer from 1 to 36500; apply must be a boolean" }, { status: 400 });
  if (!isOwner()) return Response.json({ error: "owner access required" }, { status: 403 });
  if (input.apply && applying) return Response.json({ error: "Transcript compression is already running." }, { status: 409 });
  const deps: CompressionDeps = {
    logsDir: LOGS_DIR,
    now: Date.now(),
    isActive: (id) => [...agents.values()].some((agent) => agent.sessionId === id),
    canApply: () => isOwner() && !req.signal.aborted,
  };
  if (input.apply) applying = true;
  try {
    const plan = planCompression(input.olderThanDays as number, deps);
    const applied = input.apply ? await applyCompression(plan, deps) : null;
    return Response.json({ plan, applied });
  } catch (error) {
    console.error("[storage] compression request failed:", error);
    return Response.json({ error: "Could not read or compress transcripts. Check the server log." }, { status: 500 });
  } finally {
    if (input.apply) applying = false;
  }
}
