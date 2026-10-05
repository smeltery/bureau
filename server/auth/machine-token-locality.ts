import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import { resolveAppToken } from "../apps/tokens.ts";
import { resolveCronRunBearer } from "../cronjobs/run-messaging.ts";

/**
 * Agent, cron-run and app tokens are only ever handed to processes on this
 * machine, so one presented off-box (through the public URL or a proxy) is
 * refused like an invalid token: a leaked one is useless from outside.
 * Personal API tokens are meant for other machines and are not checked here.
 */
export function refuseOffBoxMachineToken(req: Request, onBox: boolean): Response | null {
  if (onBox) return null;
  const raw = readBearerToken(req);
  if (!raw) return null;
  const holder = resolveAgentToken(raw)?.agentId ?? resolveCronRunBearer(raw)?.runId ?? resolveAppToken(raw)?.appName;
  if (!holder) return null;
  console.warn(`[auth] refused an off-box machine token (${holder}); agent, cron-run and app tokens work only from this machine`);
  return new Response(JSON.stringify({ error: "invalid bearer token" }), {
    status: 401,
    headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
  });
}
