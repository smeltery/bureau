import type { AuthResult } from "../auth/auth-middleware.ts";
import { buildUsageReportData, usageAudienceForUser } from "../agents/usage/report.ts";
import { getUserById } from "../users.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export function handleUsageRequest(req: Request, url: URL, auth: AuthResult | undefined): Response | null {
  if (url.pathname !== "/api/usage") return null;
  if (req.method !== "GET") return jsonError(405, "method not allowed");
  if (auth?.kind !== "ok") return jsonError(401, "unauthenticated");

  const user = getUserById(auth.session.userId);
  return json(buildUsageReportData(usageAudienceForUser(user)));
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: JSON_HEADERS });
}
