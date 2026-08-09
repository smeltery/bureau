import type { AuthResult } from "../auth/auth-middleware.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export interface ViewChangeInput {
  order?: string[];
  notifRooms?: string[];
  defaultRoomId?: string | null;
}

export interface ViewHttpDeps {
  applyView(userId: string, change: ViewChangeInput): boolean;
}

/**
 * Handle self-scoped view preference routes:
 *   PUT /api/me/view/order        — set sparse room ordering.
 *   PUT /api/me/view/notif-rooms  — set notification room allowlist.
 *   PUT /api/me/view/default-room — set or clear the default room.
 *
 * Returns null for any other URL so the caller can fall through.
 */
export async function handleViewRequest(req: Request, url: URL, auth: AuthResult | undefined, deps: ViewHttpDeps): Promise<Response | null> {
  const route = viewRoute(url.pathname);
  if (!route) return null;
  if (req.method !== "PUT") return null;
  // DELIBERATELY session-only: no `privilegedAgentIdentity` path here. These are
  // a specific HUMAN's per-user UI preferences, keyed off `auth.session.userId`
  // with no target parameter — an agent writing them would be rearranging its
  // boss's screen, not managing the office. Upstream excludes `view:manage` from
  // the privileged set on the same "not the agent's to touch" grounds.
  if (auth?.kind !== "ok") return jsonError(401, "unauthenticated");
  const body = await readJsonBody(req);
  if (!body) return jsonError(400, "invalid JSON body");

  if (route === "order") {
    const order = body.order;
    if (!isStringArray(order)) return jsonError(422, "order must be an array of room ids");
    return apply(auth.session.userId, { order }, deps);
  }

  if (route === "notif-rooms") {
    const notifRooms = body.notifRooms;
    if (!isStringArray(notifRooms)) return jsonError(422, "notifRooms must be an array of room ids");
    return apply(auth.session.userId, { notifRooms }, deps);
  }

  const defaultRoomId = body.defaultRoomId;
  if (defaultRoomId !== null && typeof defaultRoomId !== "string") {
    return jsonError(422, "defaultRoomId must be a room id string or null");
  }
  return apply(auth.session.userId, { defaultRoomId }, deps);
}

function apply(userId: string, change: ViewChangeInput, deps: ViewHttpDeps): Response {
  if (!deps.applyView(userId, change)) return jsonError(404, "user not found");
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

function viewRoute(pathname: string): "order" | "notif-rooms" | "default-room" | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 4 || parts[0] !== "api" || parts[1] !== "me" || parts[2] !== "view") return null;
  if (parts[3] === "order" || parts[3] === "notif-rooms" || parts[3] === "default-room") return parts[3];
  return null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}
