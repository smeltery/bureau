import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIntegrationStore } from "./store.ts";
import { excludedSecretHost, validSecretHost } from "../../shared/integrations/connections.ts";

test("scoped integrations keep secret values private and rotate without losing references", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-integrations-"));
  const store = createIntegrationStore(root);
  const scope = { kind: "member" as const, userId: "member1" };
  try {
    store.setSecret(scope, "SERVICE_TOKEN", { value: "private-credential", hosts: ["api.example.com"], form: { kind: "authorization" } });
    const first = store.privateSecrets(scope)[0]!;
    expect(JSON.stringify(store.list(scope))).not.toContain("private-credential");
    expect(store.list({ kind: "office" }).secrets).toHaveLength(0);
    store.setMcp(scope, "service", { url: "https://api.example.com/mcp", secret: "SERVICE_TOKEN" });
    store.setSecret(scope, "SERVICE_TOKEN", { value: "rotated-credential" });
    expect(store.privateSecrets(scope)[0]!.generation).toBe(first.generation);
    expect(store.list(scope).mcp[0]!.secret).toBe("SERVICE_TOKEN");
    expect(() => store.setMcp(scope, "wrong", { url: "https://other.example.com/mcp", secret: "SERVICE_TOKEN" })).toThrow("allows");
    expect(statSync(join(root, "integrations/member-member1.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, "integrations")).mode & 0o777).toBe(0o700);
    store.remove(scope, "secrets", "SERVICE_TOKEN");
    store.setSecret(scope, "SERVICE_TOKEN", { value: "another-credential", hosts: ["api.example.com"], form: { kind: "authorization" } });
    expect(store.privateSecrets(scope)[0]!.generation).not.toBe(first.generation);
    store.removeMember(scope.userId);
    expect(store.scopes()).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("corrupt stores are preserved and host restrictions fail closed", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-integrations-"));
  const store = createIntegrationStore(root);
  const scope = { kind: "office" as const };
  try {
    for (const host of ["api.openai.com", "registry.npmjs.org", "bedrock-runtime.us-east-1.amazonaws.com", "us-central1-aiplatform.googleapis.com"]) {
      expect(excludedSecretHost(host)).toBe(true);
      expect(validSecretHost(host)).toBe(false);
    }
    for (const host of ["*.example.com", "EXAMPLE.com", "api.example.com:443", "127.0.0.1", "localhost"]) expect(validSecretHost(host)).toBe(false);
    expect(() => store.setSecret(scope, "HTTPS_PROXY", { value: "private-value", hosts: ["api.example.com"], form: { kind: "authorization" } })).toThrow("reserved");
    expect(() => store.setSecret(scope, "TOKEN", { value: "short", hosts: ["api.example.com"], form: { kind: "authorization" } })).toThrow("8–16,384");
    store.setSecret(scope, "TOKEN", { value: "private-value", hosts: ["api.example.com"], form: { kind: "authorization" } });
    const file = join(root, "integrations/office.json");
    writeFileSync(file, "corrupt");
    expect(() => store.setSecret(scope, "TOKEN", { value: "replacement" })).toThrow("preserved");
    expect(readFileSync(file, "utf8")).toBe("corrupt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
