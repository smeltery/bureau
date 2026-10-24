import { expect, test } from "bun:test";
import { BureauLogError, errorLogParam } from "./error.ts";
import { displayLogContent, logContent, logMessage } from "../log-message.ts";

test("owned errors retain canonical diagnostics and nested reader-language metadata", () => {
  const message = logMessage("logs.backendError.http", { status: 503, path: "/session/literal" });
  const error = new BureauLogError(message);
  expect(error.message).toBe("OpenCode HTTP 503 at /session/literal.");
  const entry = { ...logContent(logMessage("logs.session.error", { error: errorLogParam(error) })), kind: "error" as const };
  for (const language of ["en", "es", "ca", "zh"] as const) {
    const text = displayLogContent(entry, language);
    expect(text).toContain("503");
    expect(text).toContain("/session/literal");
    if (language !== "en") expect(text).not.toBe(entry.content);
  }
  expect(errorLogParam(new Error(error.message))).toBe(error.message);
  expect(errorLogParam({ logMessage: message, message: "untrusted" })).not.toEqual(message);
  expect(errorLogParam(new TypeError("Literal provider detail {value}"))).toBe("Literal provider detail {value}");
});
