import type { AuthResult } from "../auth/auth-middleware.ts";
import { getUserById, getUserByName } from "../users.ts";
import { privilegedAgentIdentity } from "../http/agent-route-helpers.ts";
import { readBearerToken } from "../agents/tokens.ts";
import type { UsersHttpDeps } from "../http/users.ts";
import { instructionConflict, instructionSnapshot } from "./instructions.ts";

export async function handleMemberInstructions(req: Request, username: string, auth: AuthResult | undefined, deps: UsersHttpDeps): Promise<Response> {
  const operator = privilegedAgentIdentity(req);
  const bearer = readBearerToken(req);
  if (bearer && !operator) return Response.json({ error: "privileged agent required" }, { status: 403 });
  const actor = operator?.manager ?? (auth?.kind === "ok" ? getUserById(auth.session.userId) : null);
  if (!actor) return Response.json({ error: "authentication required" }, { status: 401 });
  const user = getUserByName(username);
  if (!user || (actor.role !== "owner" && actor.id !== user.id)) return Response.json({ error: "member not found" }, { status: 404 });
  if (req.method === "GET") return Response.json(instructionSnapshot(user), { headers: { "Cache-Control": "no-store" } });
  if (req.method !== "PATCH") return Response.json({ error: "method not allowed" }, { status: 405 });
  let body: Record<string, unknown>;
  try {
    const reader = req.body?.getReader();
    if (!reader) throw new Error("missing body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 128 * 1024) {
          await reader.cancel();
          return Response.json({ error: "request too large" }, { status: 413 });
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (Buffer.byteLength(text) > 128 * 1024) return Response.json({ error: "request too large" }, { status: 413 });
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
  } catch {
    return Response.json({ error: "invalid JSON object" }, { status: 400 });
  }
  if (!Object.hasOwn(body, "memberPrompt") || Object.keys(body).some((key) => key !== "memberPrompt" && key !== "memberPromptVersion")) {
    return Response.json({ error: "only memberPrompt and memberPromptVersion are accepted" }, { status: 400 });
  }
  // Re-read after the asynchronous body read so another write cannot invalidate the check.
  const latestActor = bearer ? privilegedAgentIdentity(req)?.manager : getUserById(actor.id);
  if (!latestActor || (latestActor.role !== "owner" && latestActor.id !== user.id)) return Response.json({ error: "forbidden" }, { status: 403 });
  const current = getUserById(user.id);
  if (!current) return Response.json({ error: "member not found" }, { status: 404 });
  const conflict = instructionConflict(current, body);
  if (conflict) return Response.json({ error: conflict, ...instructionSnapshot(current) }, { status: conflict.startsWith("version conflict") ? 409 : 400 });
  const result = await deps.update(latestActor.id, latestActor.role, current.name, { memberPrompt: body.memberPrompt as string | null, memberPromptVersion: body.memberPromptVersion as string });
  return result.ok ? Response.json(instructionSnapshot(result.user)) : Response.json({ error: result.error }, { status: result.status });
}
