import { createHash } from "node:crypto";
import type { Webhook } from "../../shared/integrations/webhooks.ts";
import { boundedBody, selectWebhookData, validSignature } from "./protocol.ts";
import { claimDelivery, finishDelivery, listWebhooks, webhookSecret } from "./store.ts";
import { dispatchWebhook } from "./targets.ts";

const windows = new Map<string, { at: number; count: number }>();
let inFlight = 0;
export const webhookDispatch = { send: dispatchWebhook };

export async function handleWebhookIngress(req: Request, url: URL): Promise<Response | null> {
  const match = /^\/hooks\/github\/([a-f0-9]{32})$/.exec(url.pathname);
  if (!match) return null;
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const hook = listWebhooks().find((row) => row.id === match[1]);
  const secret = hook && webhookSecret(hook.id);
  if (!hook || !hook.enabled || !secret) return new Response(null, { status: 404 });
  const now = Date.now();
  for (const [id, window] of windows) if (now - window.at >= 60_000) windows.delete(id);
  const recent = windows.get(hook.id);
  if (inFlight >= 20 || (recent && now - recent.at < 60_000 && recent.count >= 120)) return new Response(null, { status: 429 });
  if (!recent || now - recent.at >= 60_000) windows.set(hook.id, { at: now, count: 1 });
  else recent.count++;
  inFlight++;
  try {
    return await receive(req, hook, secret, now);
  } finally {
    inFlight--;
  }
}

async function receive(req: Request, hook: Webhook, secret: string, now: number): Promise<Response> {
  let body: Buffer;
  try {
    body = await boundedBody(req);
  } catch {
    return new Response(null, { status: 413 });
  }
  if (webhookSecret(hook.id) !== secret || JSON.stringify(listWebhooks().find((row) => row.id === hook.id)) !== JSON.stringify(hook)) return new Response(null, { status: 409 });
  if (!validSignature(secret, body, req.headers.get("x-hub-signature-256"))) return new Response(null, { status: 401 });
  const id = req.headers.get("x-github-delivery") ?? "";
  const event = req.headers.get("x-github-event") ?? "";
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !/^[a-z][a-z0-9_]{0,63}$/.test(event)) return new Response(null, { status: 400 });
  let data: string | null;
  try {
    data = selectWebhookData(hook, event, JSON.parse(body.toString("utf8")));
  } catch {
    return new Response(null, { status: 400 });
  }
  const digest = createHash("sha256").update(body).digest("hex");
  try {
    if (!claimDelivery(hook.id, { id, event, at: now, digest, status: "pending" })) return Response.json({ duplicate: true });
  } catch {
    return new Response(null, { status: 503 });
  }
  if (data === null) {
    finishDelivery(hook.id, id, { status: "ignored" });
    return Response.json({ ignored: true });
  }
  try {
    // No await between rechecking the current target and starting dispatch.
    const current = listWebhooks().find((row) => row.id === hook.id);
    if (!current?.enabled) throw new Error("webhook disabled");
    const resultId = webhookDispatch.send(current, data, id);
    finishDelivery(hook.id, id, { status: "accepted", resultId });
    return Response.json({ accepted: true, resultId }, { status: 202 });
  } catch {
    finishDelivery(hook.id, id, { status: "failed", error: "Target unavailable or delivery failed; inspect the target before sending a new event." });
    return Response.json({ error: "delivery failed" }, { status: 409 });
  }
}
