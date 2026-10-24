import { expect, test } from "bun:test";
import { translatorFor } from "../../../shared/i18n/translate.ts";
import { pluginFailure, pluginFailureText, pluginRequest } from "./api.ts";

test("plugin failures preserve provider details and translate owned failures at display time", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/detail") return Response.json({ error: "Original detail {name}" }, { status: 409 });
      if (path === "/malformed") return new Response("not JSON", { status: 502 });
      return Response.json({}, { status: 503 });
    },
  });
  try {
    for (const path of ["/detail", "/malformed", "/empty"]) {
      const caught = await pluginRequest(new URL(path, server.url).href).catch((error: unknown) => error);
      const failure = pluginFailure(caught);
      for (const language of ["en", "es", "ca", "zh"] as const) {
        const { t } = translatorFor(language);
        expect(pluginFailureText(failure, t)).toBe(path === "/detail" ? "Original detail {name}" : t("pluginsUi.actionFailed"));
      }
    }
    expect(pluginFailure(new TypeError("Failed to fetch"))).toEqual({ fallback: true });
  } finally {
    server.stop(true);
  }
});

test("plugin requests preserve GET queries and POST identifiers and scopes", async () => {
  const received: unknown[] = [];
  const catalog = { installed: [], available: [], marketplaces: [], fetchedAt: 1 };
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({ method: request.method, search: new URL(request.url).search, body: request.method === "POST" ? await request.json() : null });
      return Response.json(catalog);
    },
  });
  try {
    expect(await pluginRequest(new URL("/?refresh=1", server.url).href)).toEqual(catalog);
    expect(await pluginRequest(server.url.href, { plugin: "original@market", scope: "project" })).toEqual(catalog);
    expect(received).toEqual([
      { method: "GET", search: "?refresh=1", body: null },
      { method: "POST", search: "", body: { plugin: "original@market", scope: "project" } },
    ]);
  } finally {
    server.stop(true);
  }
});
