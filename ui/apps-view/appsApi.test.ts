import { expect, test } from "bun:test";
import { translatorFor } from "../../shared/i18n/translate.ts";
import { appsFetch, appFailure, appFailureText, AppUiError } from "./appsApi.ts";

test("app failures retain server details and translate owned failures at display time", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/detail") return Response.json({ error: { code: "original", message: "Original detail {name}" } }, { status: 409 });
      if (path === "/malformed") return new Response("not JSON", { status: 502 });
      if (path === "/invalid-success") return new Response("not JSON");
      if (path === "/empty-success") return new Response("");
      return Response.json({}, { status: 503 });
    },
  });
  try {
    for (const path of ["/detail", "/malformed", "/empty", "/invalid-success", "/empty-success"]) {
      const caught = await appsFetch("GET", new URL(path, server.url).href).catch((error: unknown) => error);
      const failure = appFailure(caught, "apps.loadFailed");
      for (const language of ["en", "es", "ca", "zh"] as const) {
        const { t } = translatorFor(language);
        expect(appFailureText(failure, t)).toBe(
          path === "/detail" ? "Original detail {name}" : path.endsWith("success") ? t("apps.loadFailed") : t("appsUi.httpError", { status: path === "/malformed" ? 502 : 503 }),
        );
        expect(appFailureText(appFailure(new AppUiError("appsUi.chatVerify"), "apps.loadFailed"), t)).toBe(t("appsUi.chatVerify"));
      }
    }
    expect(appFailure(new TypeError("Failed to fetch"), "apps.loadFailed")).toEqual({ key: "apps.loadFailed" });
  } finally {
    server.stop(true);
  }
});

test("app requests preserve methods and queries and accept successful empty deletion", async () => {
  const received: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      received.push({ method: request.method, path: new URL(request.url).pathname, query: new URL(request.url).search });
      return request.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ state: "running" });
    },
  });
  try {
    expect(await appsFetch<{ state: string }>("POST", new URL("/original/restart?value=kept", server.url).href)).toEqual({ state: "running" });
    expect(await appsFetch<null>("DELETE", server.url.href)).toBeNull();
    expect(received).toEqual([
      { method: "POST", path: "/original/restart", query: "?value=kept" },
      { method: "DELETE", path: "/", query: "" },
    ]);
  } finally {
    server.stop(true);
  }
});
