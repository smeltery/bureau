import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { isClaudeCloudSelected, isClaudeCodeAuthenticated } from "./claude-install-check.ts";

const tempRoots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bureau-claude-check-"));
  tempRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

describe("Claude Code effective-environment probes", () => {
  for (const selector of ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"]) {
    test(`recognizes enabled ${selector} without local login`, () => {
      const env = { CLAUDE_CONFIG_DIR: tempDir(), ANTHROPIC_API_KEY: "" };
      for (const value of ["1", "true", "yes", "on", " TRUE ", "On"]) {
        expect(isClaudeCloudSelected({ ...env, [selector]: value })).toBe(true);
        expect(isClaudeCodeAuthenticated({ ...env, [selector]: value })).toBe(true);
      }
      for (const value of ["", "0", "false", "off", "no", "enabled"]) {
        expect(isClaudeCloudSelected({ ...env, [selector]: value })).toBe(false);
        expect(isClaudeCodeAuthenticated({ ...env, [selector]: value })).toBe(false);
      }
    });
  }

  test("recognizes token credentials without treating whitespace as authentication", () => {
    for (const key of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"]) {
      const env = { CLAUDE_CONFIG_DIR: tempDir() };
      expect(isClaudeCodeAuthenticated({ ...env, [key]: "test-token" })).toBe(true);
      expect(isClaudeCodeAuthenticated({ ...env, [key]: "  " })).toBe(false);
    }
  });

  test("resolves credentials from the effective CLAUDE_CONFIG_DIR", () => {
    const signedIn = tempDir();
    const signedOut = tempDir();
    writeFileSync(join(signedIn, ".credentials.json"), "{}");

    expect(isClaudeCodeAuthenticated({ CLAUDE_CONFIG_DIR: signedIn })).toBe(true);
    expect(isClaudeCodeAuthenticated({ CLAUDE_CONFIG_DIR: signedOut })).toBe(false);
  });
});
