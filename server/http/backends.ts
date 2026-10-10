import type { AgentBackendType } from "../../shared/types.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { openCodeEnvironmentId } from "../backends/opencode/profiles/identity.ts";
import { getBackend } from "../backends/index.ts";
import { readEnvFile } from "../persistence.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import * as AgentManager from "../agent-manager.ts";
import { validateCwd } from "../agents/session/paths.ts";

const jsonHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export async function handleBackendsRequest(req: Request, url: URL, auth: AuthResult): Promise<Response | null> {
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/backends/")) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "backends" || parts[3] !== "models") return null;
  if (auth.kind !== "ok") return json({ models: [], error: "authenticated browser session required" }, 401);
  if (req.method !== "GET") return json({ models: [], error: "not found" }, 404);

  const agentType = parseAgentType(parts[2]);
  if (!agentType) return json({ models: [], error: "unknown backend" }, 404);

  const cwd = url.searchParams.get("cwd") || process.cwd();
  let resolvedCwd: string;
  try {
    resolvedCwd = validateCwd(cwd);
  } catch (err) {
    return json({ models: [], error: err instanceof Error ? err.message : "invalid directory" });
  }

  const agentId = url.searchParams.get("agentId");
  const agent = agentId ? AgentManager.getAgent(agentId) : undefined;
  if (agentId && !agent) return json({ models: [], error: "not found" }, 404);
  const roomId = agent ? (agent.roomId ?? AgentManager.getRooms()[agent.room]?.id) : url.searchParams.get("roomId");
  const viewer = getUserById(auth.session.userId);
  if ((agent && !roomId) || (roomId && (!viewer || !AgentManager.getRoomSettings(roomId) || !canSeeRoom(viewer, roomId)))) {
    return json({ models: [], error: "not found" }, 404);
  }
  let managerUserId = agent ? agent.userId : auth.session.userId;
  if (url.searchParams.has("userId")) {
    const requestedUserId = url.searchParams.get("userId") || null;
    if (auth.session.role !== "owner" && requestedUserId !== auth.session.userId) return json({ models: [], error: "forbidden" }, 403);
    if (requestedUserId && !getUserById(requestedUserId)) return json({ models: [], error: "not found" }, 404);
    managerUserId = requestedUserId;
  }

  const backend = getBackend(agentType);
  try {
    const models = await backend.listModels({
      cwd: resolvedCwd,
      environmentId: openCodeEnvironmentId(managerUserId, roomId),
      env: buildUserEnv(managerUserId ?? null, roomId ?? null),
      includeHidden: url.searchParams.get("includeHidden") === "true",
    });
    return json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to list models";
    return json({ models: [], error: message, authError: backend.detectAuthError(message) });
  }
}

function parseAgentType(value: string | undefined): AgentBackendType | null {
  return value === "claude" || value === "codex" || value === "opencode" ? value : null;
}

function buildUserEnv(userId: string | null, roomId: string | null): { [key: string]: string | undefined } | undefined {
  const officeEnvFile = AgentManager.getOfficeSettings().envFile;
  const userEnvFile = userId ? (getUserById(userId)?.envFile ?? null) : null;
  const roomEnvFile = roomId ? AgentManager.getRoomSettings(roomId)?.envFile : null;
  if (!officeEnvFile && !roomEnvFile && !userEnvFile) return undefined;
  const merged: { [key: string]: string | undefined } = { ...process.env };
  if (officeEnvFile) Object.assign(merged, readEnvFile(officeEnvFile));
  if (roomEnvFile) Object.assign(merged, readEnvFile(roomEnvFile));
  if (userEnvFile) Object.assign(merged, readEnvFile(userEnvFile));
  return merged;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}
