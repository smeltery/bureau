import { expect, test } from "bun:test";
import { displayLogContent, logContent } from "../../../../shared/i18n/log-message.ts";
import { providerDetail, providerRefusal, providerRetry, providerSignInFailure } from "./provider-details.ts";

test("provider details redact credentials before bounding Unicode text", () => {
  const secret = "sk-" + "A".repeat(30);
  const input =
    `Limit reached. Bearer private-bearer Basic private-basic https://name:private-pass@example.com/?key=short-key&token=short-token password='short pass' "access_token":"short-access" ${secret} ` +
    "🙂".repeat(400);
  const detail = providerDetail(input)!;
  for (const hidden of ["private-bearer", "private-basic", "private-pass", "short-key", "short-token", "short pass", "short-access", secret]) expect(detail).not.toContain(hidden);
  expect(detail).toContain("Limit reached.");
  expect(Array.from(detail)).toHaveLength(300);
  expect(detail.endsWith("…")).toBe(true);
  expect(providerDetail("\u202eBlocked\u2069\n\t now")).toBe("Blocked now");
  expect(providerDetail(" \n")).toBeNull();
});

test("refusals preserve provider words in every reader language", () => {
  for (const statusCode of [400, 402, 403, 404, 429]) {
    const message = providerRefusal({ name: "APIError", statusCode, message: "Plan excludes this model" }, "vendor/model")!;
    expect(message).not.toBeNull();
    const entry = { kind: "error" as const, ...logContent(message) };
    for (const language of ["en", "es", "ca", "zh"] as const) {
      expect(displayLogContent(entry, language)).toContain("Plan excludes this model");
      expect(displayLogContent(entry, language)).toContain("vendor/model");
      if (language !== "en") expect(displayLogContent(entry, language)).not.toBe(entry.content);
    }
  }
  expect(providerRefusal({ name: "APIError", message: "quota exhausted" })).not.toBeNull();
  for (const error of [
    { name: "APIError", statusCode: 401, message: "bad token" },
    { name: "APIError", statusCode: 503, message: "failed" },
    { name: "ProviderAuthError", message: "quota" },
    { name: "APIError", statusCode: 403 },
    { name: "APIError", message: "ECONNREFUSED" },
  ])
    expect(providerRefusal(error)).toBeNull();
});

test("retry details are inert markdown and free-tier hints remain conditional", () => {
  const retry = logContent(providerRetry("[click](https://example.com) <img> *bold* user@example.com", 2, "vendor/model")).content;
  expect(retry).toContain("[click](https://example.com)");
  expect(retry).toContain("<img> *bold* user@example.com");
  expect(retry).not.toContain("\n");
  expect(retry).toContain("retry 2");
  const refusal = providerRefusal({ name: "APIError", statusCode: 403, message: "Free tier can only be used from within OpenCode" })!;
  expect(logContent(refusal).content).toContain("may be a free-tier restriction");
});

test("sign-in failures without provider words identify the model and offer recovery", () => {
  for (const error of [{ statusCode: 401 }, { name: "ProviderAuthError", message: "  " }]) {
    const event = providerSignInFailure(error, "vendor/model", false);
    expect(event).toMatchObject({ causedByAuth: false, pickModel: true });
    for (const language of ["en", "es", "ca", "zh"] as const) {
      const text = displayLogContent({ kind: "error", ...logContent(event.errorMessage!) }, language);
      expect(text).toContain("vendor/model");
      if (language !== "en") expect(text).not.toBe(event.error);
    }
    expect(providerSignInFailure(error, "opencode/paid", true)).toMatchObject({ causedByAuth: true, errorMessage: { key: "logs.provider.auth" } });
  }
});
