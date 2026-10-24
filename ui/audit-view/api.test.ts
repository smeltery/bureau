import { expect, test } from "bun:test";
import { translatorFor } from "../../shared/i18n/translate.ts";
import { auditRequest, auditFailure, auditFailureText } from "./api.ts";

test("audit and recording feedback translates owned failures and preserves server details", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/detail") return Response.json({ error: "Original error {value}" }, { status: 403 });
      if (path === "/malformed") return new Response("not JSON", { status: 502 });
      return Response.json({}, { status: 503 });
    },
  });
  try {
    for (const path of ["/detail", "/malformed", "/empty"]) {
      const caught = await auditRequest(new URL(path, server.url).href).catch((error: unknown) => error);
      for (const key of ["auditUi.loadFailed", "auditUi.recordingFailed"] as const) {
        const failure = auditFailure(caught, key);
        for (const language of ["en", "es", "ca", "zh"] as const) {
          const { t } = translatorFor(language);
          expect(auditFailureText(failure, t)).toBe(path === "/detail" ? "Original error {value}" : t(key));
        }
      }
    }
    expect(auditFailure(new TypeError("Failed to fetch"), "auditUi.loadFailed")).toEqual({ key: "auditUi.loadFailed" });
  } finally {
    server.stop(true);
  }
});

test("audit requests preserve filters, pagination, and recording settings bodies", async () => {
  const received: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      received.push({ method: request.method, query: Object.fromEntries(url.searchParams), body: request.method === "PATCH" ? await request.json() : null });
      return Response.json({ ok: true });
    },
  });
  try {
    await auditRequest(new URL("/?actor=Original&operation=terminal.open&cursor=next", server.url).href);
    await auditRequest(server.url.href, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    expect(received).toEqual([
      { method: "GET", query: { actor: "Original", operation: "terminal.open", cursor: "next" }, body: null },
      { method: "PATCH", query: {}, body: { enabled: true } },
    ]);
  } finally {
    server.stop(true);
  }
});
