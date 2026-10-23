import type { AuthResult } from "../../auth/auth-middleware.ts";
import { getUserById } from "../../users.ts";
import { providerLoginManager } from "./runtime.ts";
import { AccountError, type AccountScope } from "./types.ts";
import type { ProviderAccountProvider } from "../../../shared/provider-accounts.ts";
import { boundedBody } from "../../http/body/bounded.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function handleProviderLogin(req: Request, url: URL, authenticate: () => AuthResult, manager = providerLoginManager): Promise<Response | null> {
  const match = /^\/api\/me\/provider-accounts\/(claude|codex)\/(login|disconnect)$/.exec(url.pathname);
  if (!match) return null;
  const auth = authenticate();
  if (auth.kind !== "ok" || req.headers.has("authorization")) return json({ error: "Browser sign-in required." }, 401);
  const provider = match[1] as ProviderAccountProvider;
  const userId = auth.session.userId;
  const scope = url.searchParams.get("scope");
  if ((scope !== "office" && scope !== "personal") || url.searchParams.getAll("scope").length !== 1) return json({ error: "Choose office or personal account scope." }, 422);
  const currentUser = () => {
    const current = authenticate();
    return current.kind === "ok" && current.session.userId === userId ? getUserById(userId) : null;
  };
  const canManage = () => {
    const user = currentUser();
    return !!user && (scope === "personal" || user.role === "owner");
  };
  if (!currentUser()) return json({ error: "Browser sign-in required." }, 401);
  if (req.method !== "GET" && !canManage()) return json({ error: "Only owners can manage the office account." }, 403);
  try {
    if (req.method === "GET" && match[2] === "login") {
      const status = await manager.status(userId, provider, scope, url.searchParams.get("refresh") === "true");
      if (!currentUser()) return json({ error: "Browser sign-in required." }, 401);
      return json(status);
    }
    if (!["POST", "PUT", "DELETE"].includes(req.method)) return json({ error: "Method not allowed." }, 405);
    const body = await readBody(req);
    if (!canManage()) return json({ error: "Sign-in authorization expired." }, 403);
    if (match[2] === "disconnect") {
      if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (body.confirm !== "DISCONNECT") throw new AccountError("Confirm disconnecting this provider account.");
      await manager.disconnect(userId, provider, scope, canManage);
    } else if (req.method === "POST") {
      const method = body.method ?? (provider === "codex" ? "device" : "browser");
      if (method !== "browser" && method !== "device") throw new AccountError("Choose browser or device sign-in.");
      if (provider === "claude" && method !== "browser") throw new AccountError("Claude uses browser sign-in.");
      const status = await manager.start(userId, currentUser()!.name, provider, scope, method, canManage);
      if (!canManage()) return json({ error: "Sign-in authorization expired." }, 403);
      return json(status);
    } else {
      if (typeof body.operationId !== "string" || body.operationId.length > 128) throw new AccountError("Choose the active sign-in operation.");
      if (req.method === "PUT") {
        if (typeof body.code !== "string" || body.code.length > 8192) throw new AccountError("Paste the sign-in code.");
        await manager.callback(userId, provider, scope, body.operationId, body.code);
      } else await manager.cancel(userId, provider, scope, body.operationId, currentUser()?.role === "owner");
    }
    if (!currentUser()) return json({ error: "Browser sign-in required." }, 401);
    const status = await manager.status(userId, provider, scope as AccountScope, true);
    if (!canManage()) return json({ error: "Sign-in authorization expired." }, 403);
    return json(status);
  } catch (error) {
    if (error instanceof AccountError) return json({ error: error.message }, error.status);
    return json({ error: "Could not manage this provider account. Check its configuration or use the terminal login command." }, 502);
  }
}
async function readBody(req: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse((await boundedBody(req, 16 * 1024)).toString("utf8"));
  } catch {
    throw new AccountError("Invalid or oversized sign-in request.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountError("Sign-in request must be an object.");
  return value as Record<string, unknown>;
}
