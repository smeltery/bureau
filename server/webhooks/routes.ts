import { randomBytes } from "node:crypto";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { getUserById } from "../users.ts";
import { getPublicOrigin } from "../public-origin.ts";
import { boundedBody, parseHookInput, selectWebhookData } from "./protocol.ts";
import { deleteWebhook, listDeliveries, listWebhooks, rotateWebhookSecret, saveWebhook } from "./store.ts";
import { canUseWebhookTarget } from "./targets.ts";

export async function handleWebhookManagement(req: Request, url: URL, auth?: AuthResult): Promise<Response | null> {
  const match = /^\/api\/webhooks(?:\/([a-f0-9]{32})(?:\/(deliveries|test|rotate))?)?$/.exec(url.pathname);
  if (!match) return null;
  const user = auth?.kind === "ok" ? getUserById(auth.session.userId) : null;
  if (!user) return Response.json({ error: "browser session required" }, { status: 401 });
  const [id, action] = match.slice(1);
  const hooks = listWebhooks();
  const hook = hooks.find((row) => row.id === id);
  const visible = (row: (typeof hooks)[number]) => user.role === "owner" || canUseWebhookTarget(user, row.target, false);
  if (id && (!hook || !visible(hook))) return Response.json({ error: "not found" }, { status: 404 });
  const link = (hookId: string) => `${getPublicOrigin().replace(/\/$/, "")}/hooks/github/${hookId}`;
  if (req.method === "GET") {
    if (action === "deliveries") return Response.json(listDeliveries(id));
    if (id) return Response.json({ ...hook, url: link(id) });
    return Response.json(hooks.filter(visible).map((row) => ({ ...row, url: link(row.id) })));
  }
  if (hook && user.role !== "owner" && hook.userId !== user.id) return Response.json({ error: "owner access required" }, { status: 403 });
  if (req.method === "DELETE" && hook && !action) {
    deleteWebhook(id);
    return new Response(null, { status: 204 });
  }
  if (req.method === "POST" && hook && action === "rotate") return Response.json({ secret: rotateWebhookSecret(id) });
  try {
    const body = JSON.parse((await boundedBody(req)).toString("utf8"));
    if (req.method === "POST" && hook && action === "test") return Response.json({ data: selectWebhookData(hook, String(body.event), body.payload) });
    if ((req.method === "POST" && !id) || (req.method === "PATCH" && hook && !action)) {
      const input = parseHookInput(hook ? { ...hook, ...body } : body);
      if (!canUseWebhookTarget(user, input.target, true)) return Response.json({ error: "target access required" }, { status: 403 });
      if (!hook && hooks.length >= 1000) return Response.json({ error: "webhook limit reached" }, { status: 409 });
      const row = { ...input, id: hook?.id ?? randomBytes(16).toString("hex"), userId: hook?.userId ?? user.id, createdAt: hook?.createdAt ?? Date.now() };
      const secret = hook ? undefined : rotateWebhookSecret(row.id);
      saveWebhook(row);
      return Response.json({ ...row, url: link(row.id), ...(secret ? { secret } : {}) }, { status: hook ? 200 : 201 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid request" }, { status: 400 });
  }
  return new Response(null, { status: 405 });
}
