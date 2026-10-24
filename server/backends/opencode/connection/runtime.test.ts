import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveOpenCodeBinary } from "../runtime.ts";
import { BureauLogError } from "../../../../shared/i18n/backend-errors/error.ts";
import { displayLogContent, logContent } from "../../../../shared/i18n/log-message.ts";

test("missing CLI guidance translates while preserving configured paths and install commands", () => {
  const directory = mkdtempSync(join(tmpdir(), "bureau-missing-cli-"));
  try {
    const path = join(directory, "literal {path}");
    for (const env of [{ PATH: directory }, { PATH: directory, OPENCODE_BINARY: path }]) {
      let error: unknown;
      try {
        resolveOpenCodeBinary(env);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(BureauLogError);
      const entry = { ...logContent((error as BureauLogError).logMessage), kind: "error" as const };
      expect(entry.content).toBe((error as Error).message);
      for (const language of ["en", "es", "ca", "zh"] as const) {
        const text = displayLogContent(entry, language);
        expect(text).toContain("OPENCODE_BINARY");
        if (env.OPENCODE_BINARY) expect(text).toContain(path);
        else {
          expect(text).toContain("`opencode`");
          expect(text).toContain("PATH");
          expect(text).toContain("https://opencode.ai");
        }
        if (language !== "en") expect(text).not.toBe(entry.content);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
