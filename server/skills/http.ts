import { join } from "node:path";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { agents, rooms, emit } from "../agents/state.ts";
import { buildSessionEnv } from "../agents/session/session-env.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import { stateChangingOriginAllowed } from "../public-origin.ts";
import { contextSkills, catalogFor, publicCatalog, type SkillContext } from "./catalog.ts";
import { absent, deleteDocument, MAX_SKILL_BYTES, readDocument, SkillError, writeDocument } from "./files.ts";

export async function handleSkillsRequest(req: Request, url: URL, auth: AuthResult | undefined, resolveContext = authorizedContext): Promise<Response | null> {
  if (url.pathname !== "/api/skills") return null;
  if (auth?.kind !== "ok") return Response.json({ error: "Authenticated browser session required." }, { status: 401 });
  if (!stateChangingOriginAllowed(req, url)) return Response.json({ error: "Forbidden origin." }, { status: 403 });
  try {
    const context = resolveContext(url.searchParams.get("agentId"), auth);
    const catalog = catalogFor(context);
    const id = url.searchParams.get("id");
    if (req.method === "GET") {
      if (!id) return Response.json(publicCatalog(catalog));
      const file = catalog.files.get(id);
      if (!file) throw new SkillError("Skill not found.", 404);
      return Response.json(readDocument(file.path));
    }
    if (!context.writable) throw new SkillError("Only the office owner can edit shared host or project skills.", 403);
    if (!["POST", "PUT", "DELETE"].includes(req.method)) throw new SkillError("Method not allowed.", 405);
    // Bound the streamed body, not only the untrusted Content-Length header.
    const reader = req.body?.getReader();
    if (!reader) throw new SkillError("JSON body required.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > MAX_SKILL_BYTES * 6 + 4096) {
          await reader.cancel();
          throw new SkillError("Request too large.", 413);
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new SkillError("Invalid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SkillError("JSON object required.");
    if (req.method === "POST") {
      const root = catalog.roots.find((root) => root.id === body.rootId);
      if (!root?.writable) throw new SkillError("Read-only skill directory.", 403);
      if (typeof body.name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(body.name))
        throw new SkillError("Use a lowercase name with letters, numbers, hyphens or underscores (up to 80 characters).");
      if (typeof body.content !== "string") throw new SkillError("Content must be text.");
      writeDocument(root.commands ? join(root.path, `${body.name}.md`) : join(root.path, body.name, "SKILL.md"), body.content, null);
    } else {
      const file = id ? catalog.files.get(id) : undefined;
      if (!file) throw new SkillError("Skill not found.", 404);
      if (!file.skill.writable) throw new SkillError("Packaged skills are read-only.", 403);
      if (typeof body.version !== "string") throw new SkillError("Version required.");
      if (req.method === "DELETE") deleteDocument(file.path, body.version);
      else {
        if (typeof body.content !== "string") throw new SkillError("Content must be text.");
        writeDocument(file.path, body.content, body.version);
      }
    }
    const managed = agents.get(url.searchParams.get("agentId") ?? "");
    if (managed) {
      managed.skills = contextSkills(context);
      emit({ type: "slash_commands", agentId: managed.info.id, commands: managed.slashCommands, skills: managed.skills });
    }
    return Response.json({ ok: true });
  } catch (error) {
    const status = error instanceof SkillError ? error.status : absent(error) ? 404 : 500;
    console.error("[skills]", error);
    return Response.json({ error: error instanceof SkillError ? error.message : status === 404 ? "Skill no longer exists." : "Unable to access the skill library. Check the server log." }, { status });
  }
}
function authorizedContext(agentId: string | null, auth: Extract<AuthResult, { kind: "ok" }>): SkillContext {
  const managed = agentId ? agents.get(agentId) : undefined;
  const viewer = getUserById(auth.session.userId);
  if (!managed || !viewer || !canSeeRoom(viewer, rooms[managed.info.room]?.id ?? "") || (auth.session.role !== "owner" && managed.info.userId !== auth.session.userId))
    throw new SkillError("Agent not found.", 404);
  return { cwd: managed.info.cwd, agentType: managed.info.agentType, env: buildSessionEnv(managed), writable: auth.session.role === "owner" };
}
