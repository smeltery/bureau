import { afterEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { validSignature, parseHookInput, selectWebhookData, boundedBody } from "./protocol.ts";
import { listDeliveries, rotateWebhookSecret, saveWebhook, WEBHOOK_DIR } from "./store.ts";
import { handleWebhookIngress, webhookDispatch } from "./ingress.ts";
import type { Webhook } from "../../shared/integrations/webhooks.ts";

const dispatch = webhookDispatch.send;
afterEach(() => {
  webhookDispatch.send = dispatch;
  rmSync(WEBHOOK_DIR, { recursive: true, force: true });
});
const hook: Webhook = {
  id: "a".repeat(32),
  name: "Build",
  target: { kind: "schedule", id: "job" },
  userId: "user",
  events: ["push"],
  actions: [],
  fields: ["repository.full_name", "ref"],
  enabled: true,
  createdAt: 1,
};

test("HMAC validates exact bytes and refuses malformed signatures", () => {
  const body = Buffer.from("Hello, World!");
  const signature = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
  expect(validSignature("It's a Secret to Everybody", body, signature)).toBe(true);
  expect(validSignature("wrong", body, signature)).toBe(false);
  expect(validSignature("It's a Secret to Everybody", Buffer.from("Hello, World!\n"), signature)).toBe(false);
  expect(validSignature("s", body, "sha256=no")).toBe(false);
});

test("rules select only explicit fields and reject unsafe paths and oversized bodies", async () => {
  expect(parseHookInput(hook).target).toEqual(hook.target);
  expect(() => parseHookInput({ ...hook, fields: ["__proto__.secret"] })).toThrow();
  const data = selectWebhookData(hook, "push", { repository: { full_name: "team/project", token: "private" }, ref: "refs/heads/main", secret: "hidden" });
  expect(data).toContain("team/project");
  expect(data).not.toContain("private");
  expect(data).not.toContain("hidden");
  expect(selectWebhookData(hook, "issues", {})).toBeNull();
  expect(selectWebhookData({ ...hook, actions: ["opened"] }, "push", { action: "closed" })).toBeNull();
  await expect(boundedBody(new Request("http://local", { method: "POST", body: "12345" }), 4)).rejects.toThrow("body too large");
});

test("signed deliveries are persisted, deduplicated by id and body, and dispatch once", async () => {
  saveWebhook(hook);
  const secret = rotateWebhookSecret(hook.id);
  expect(statSync(join(WEBHOOK_DIR, "secrets.json")).mode & 0o777).toBe(0o600);
  let sent = 0;
  webhookDispatch.send = () => {
    sent++;
    return "run-1";
  };
  async function deliver(id: string, payload: string, signingKey = secret) {
    const req = new Request(`http://local/hooks/github/${hook.id}`, {
      method: "POST",
      headers: { "x-github-event": "push", "x-github-delivery": id, "x-hub-signature-256": "sha256=" + createHmac("sha256", signingKey).update(payload).digest("hex") },
      body: payload,
    });
    return (await handleWebhookIngress(req, new URL(req.url)))!;
  }
  const body = JSON.stringify({ ref: "main" });
  expect((await deliver("delivery-1", body, "wrong")).status).toBe(401);
  expect((await deliver("delivery-1", body)).status).toBe(202);
  expect(await (await deliver("delivery-1", "{}")).json()).toEqual({ duplicate: true });
  expect(await (await deliver("delivery-2", body)).json()).toEqual({ duplicate: true });
  expect(sent).toBe(1);
  expect(listDeliveries(hook.id)).toEqual([expect.objectContaining({ id: "delivery-1", status: "accepted", resultId: "run-1" })]);
  expect(JSON.stringify(listDeliveries(hook.id))).not.toContain(secret);
  rotateWebhookSecret(hook.id);
  expect((await deliver("delivery-3", "{}")).status).toBe(401);
});

test("a removed target records a failure without leaking details", async () => {
  saveWebhook(hook);
  const secret = rotateWebhookSecret(hook.id);
  const req = new Request(`http://local/hooks/github/${hook.id}`, {
    method: "POST",
    headers: { "x-github-event": "push", "x-github-delivery": "missing", "x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update("{}").digest("hex") },
    body: "{}",
  });
  expect((await handleWebhookIngress(req, new URL(req.url)))?.status).toBe(409);
  expect(listDeliveries(hook.id)[0]?.status).toBe("failed");
});
