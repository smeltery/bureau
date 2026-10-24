import { expect, test } from "bun:test";
import { translatorFor } from "../../../../shared/i18n/translate.ts";
import { webhookRequest, webhookFailure, webhookFailureText, parseWebhookPayload, WebhookUiError } from "./api.ts";

test("webhook failures translate owned feedback without rewriting server details", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/detail") return Response.json({ error: "Original detail {name}" }, { status: 403 });
      if (path === "/malformed") return new Response("not JSON", { status: 502 });
      return Response.json({}, { status: 503 });
    },
  });
  try {
    for (const path of ["/detail", "/malformed", "/empty"]) {
      const caught = await webhookRequest(new URL(path, server.url).href).catch((error: unknown) => error);
      for (const language of ["en", "es", "ca", "zh"] as const) {
        const { t } = translatorFor(language);
        expect(webhookFailureText(webhookFailure(caught), t)).toBe(path === "/detail" ? "Original detail {name}" : t("webhooks.requestFailed"));
        expect(webhookFailureText(webhookFailure(new WebhookUiError("webhooks.clipboard")), t)).toBe(t("webhooks.clipboard"));
      }
    }
    expect(webhookFailure(new TypeError("Failed to fetch"))).toEqual({ key: "webhooks.requestFailed" });
    expect(() => parseWebhookPayload("{")).toThrow(WebhookUiError);
    expect(parseWebhookPayload('{"literal":"{name}"}')).toEqual({ literal: "{name}" });
  } finally {
    server.stop(true);
  }
});

test("webhook requests preserve action bodies and accept empty successful deletions", async () => {
  const received: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({ method: request.method, body: request.method === "POST" ? await request.json() : null });
      return request.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ data: "Original preview" });
    },
  });
  try {
    expect(await webhookRequest(server.url.href, "POST", { event: "push", payload: { ref: "refs/heads/main" } })).toEqual({ data: "Original preview" });
    expect(await webhookRequest(server.url.href, "DELETE")).toBeNull();
    expect(received).toEqual([
      { method: "POST", body: { event: "push", payload: { ref: "refs/heads/main" } } },
      { method: "DELETE", body: null },
    ]);
  } finally {
    server.stop(true);
  }
});
