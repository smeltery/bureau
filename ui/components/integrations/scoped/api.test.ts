import { expect, test } from "bun:test";
import { translatorFor } from "../../../../shared/i18n/translate.ts";
import { integrationApi, integrationFailure, integrationFailureText } from "./api.ts";

test("only client-owned integration failures translate; server errors stay literal", async () => {
  const literal = "Original service error {value}: integrations.requestFailed";
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      return Response.json(new URL(request.url).pathname === "/literal" ? { error: literal } : {}, { status: 503 });
    },
  });
  try {
    for (const path of ["/empty", "/literal"]) {
      const caught = await integrationApi(`http://127.0.0.1:${server.port}${path}`).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(path === "/literal" ? literal : "The integration request failed.");
      const failure = integrationFailure(caught, "integrations.loadFailed");
      for (const language of ["en", "es", "ca", "zh"] as const) {
        const { t } = translatorFor(language);
        expect(integrationFailureText(failure, t)).toBe(path === "/literal" ? literal : t("integrations.requestFailed"));
      }
    }
    const { t } = translatorFor("zh");
    expect(integrationFailureText(integrationFailure(null, "integrations.testFailed"), t)).toBe(t("integrations.testFailed"));
  } finally {
    server.stop(true);
  }
});
