import { expect, test } from "bun:test";
import { translatorFor } from "../../shared/i18n/translate.ts";
import { questionFailure, questionFailureText, questionRequest } from "./api.ts";

test("question failures keep server details literal and translate owned fallbacks at display time", async () => {
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
      const caught = await questionRequest(new URL(path, server.url).href).catch((error: unknown) => error);
      const failure = questionFailure(caught, "questions.updateFailed");
      for (const language of ["en", "es", "ca", "zh"] as const) {
        const { t } = translatorFor(language);
        expect(questionFailureText(failure, t)).toBe(path === "/detail" ? "Original detail {name}" : t("questions.updateFailed"));
      }
    }
    expect(questionFailure(new TypeError("Failed to fetch"), "questions.loadFailed")).toEqual({ key: "questions.loadFailed" });
  } finally {
    server.stop(true);
  }
});

test("question requests preserve action bodies and accept empty successful removals", async () => {
  let received: { method: string; body: unknown } | undefined;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      received = { method: request.method, body: await request.json() };
      return new Response(null, { status: 204 });
    },
  });
  try {
    expect(await questionRequest(server.url.href, { method: "DELETE", body: JSON.stringify({ revision: 7 }) })).toBeNull();
    expect(received).toEqual({ method: "DELETE", body: { revision: 7 } });
  } finally {
    server.stop(true);
  }
});
