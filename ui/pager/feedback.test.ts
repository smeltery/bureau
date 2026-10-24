import { expect, test } from "bun:test";
import { translatorFor } from "../../shared/i18n/translate.ts";
import { deliveryFailureText, pageAge, pagerFailure, pagerFailureText, pagerRequest } from "./feedback.ts";

test("pager feedback preserves server details and translates delivery codes at display time", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/detail") return Response.json({ error: "Original detail {value}" }, { status: 409 });
      if (path === "/delivery") return Response.json({ failure: "rate_limited" }, { status: 502 });
      if (path === "/empty") return new Response(null, { status: 204 });
      return new Response("not JSON", { status: 502 });
    },
  });
  try {
    for (const path of ["/detail", "/delivery", "/malformed"]) {
      const caught = await pagerRequest(new URL(path, server.url).href).catch((error: unknown) => error);
      const failure = pagerFailure(caught, "pager.settings.testRequestFailed");
      for (const language of ["en", "es", "ca", "zh"] as const) {
        const { t } = translatorFor(language);
        const expected =
          path === "/detail" ? "Original detail {value}" : path === "/delivery" ? t("pager.settings.testFailed", { reason: t("pager.failure.rateLimited") }) : t("pager.settings.testRequestFailed");
        expect(pagerFailureText(failure, t)).toBe(expected);
        expect(deliveryFailureText("constructor", t)).toBe("constructor");
      }
    }
    expect(await pagerRequest(new URL("/empty", server.url).href, { method: "POST" })).toBeUndefined();
    expect(pagerFailure(new TypeError("Failed to fetch"), "pager.settings.saveFailed")).toEqual({ key: "pager.settings.saveFailed" });
  } finally {
    server.stop(true);
  }
});

test("page ages keep minute, hour and day boundaries in the reader's locale", () => {
  const now = 1_000_000_000;
  for (const language of ["en", "es", "ca", "zh"]) {
    const format = new Intl.RelativeTimeFormat(language);
    expect(pageAge(now + 60000, language, now)).toBe(format.format(-0, "minute"));
    expect(pageAge(now - 59 * 60000, language, now)).toBe(format.format(-59, "minute"));
    expect(pageAge(now - 60 * 60000, language, now)).toBe(format.format(-1, "hour"));
    expect(pageAge(now - 48 * 3600000, language, now)).toBe(format.format(-2, "day"));
  }
});
