import type { AuthResult } from "../auth/auth-middleware.ts";
import { getSkillUseCounts } from "../skill-usage.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export function handleSkillUsageRequest(req: Request, url: URL, auth: AuthResult | undefined): Response | null {
  if (url.pathname !== "/api/skill-usage" || req.method !== "GET") return null;
  if (auth?.kind !== "ok") {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }
  return new Response(JSON.stringify({ counts: getSkillUseCounts(auth.session.userId) }), {
    headers: JSON_HEADERS,
  });
}
