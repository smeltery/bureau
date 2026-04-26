import { describe, expect, test } from "bun:test";
import { FILE_READ_COMMANDS, isSensitiveFile } from "../secrets.ts";

describe("isSensitiveFile — exact matches", () => {
  test.each(["/.env", "/foo/.env", ".env", "/etc/.netrc", ".pgpass", ".my.cnf", "/srv/credentials.json", "/srv/service-account.json", "/srv/service_account.json"])("flags %s as sensitive", (path) => {
    expect(isSensitiveFile(path)).toBe(true);
  });
});

describe("isSensitiveFile — pattern matches", () => {
  test.each([
    ["/foo/.env.local", true],
    ["/foo/.env.production", true],
    ["/foo/.env.development", true],
    ["/etc/ssl/server.pem", true],
    ["/home/x/key.pem", true],
    ["/etc/api.key", true],
    ["/etc/cert.p12", true],
    ["/etc/cert.pfx", true],
    ["/etc/keystore.jks", true],
    ["/home/x/.ssh/id_rsa", true],
    ["/home/x/.ssh/id_rsa.pub", true],
    ["/home/x/.ssh/id_ed25519", true],
    ["/home/x/.ssh/id_ecdsa", true],
    ["/home/x/.ssh/id_dsa", true],
  ])("flags %s as sensitive=%s", (path, expected) => {
    expect(isSensitiveFile(path)).toBe(expected);
  });
});

describe("isSensitiveFile — safe-suffix exemptions (templates)", () => {
  test.each([".env.example", ".env.template", ".env.sample", ".env.dist", "credentials.json.example", "/etc/key.pem.example"])("treats %s as NOT sensitive", (path) => {
    expect(isSensitiveFile(path)).toBe(false);
  });
});

describe("isSensitiveFile — non-secrets", () => {
  test.each(["/etc/hosts", "/home/x/README.md", "/etc/index.html", "/var/log/app.log", "/tmp/foo.txt", "package.json", "/srv/db/data.sqlite"])("treats %s as NOT sensitive", (path) => {
    expect(isSensitiveFile(path)).toBe(false);
  });

  test("does not flag a file whose dirname contains a sensitive name", () => {
    // The check is on basename only — `/foo/.env/bar` is not the .env file.
    expect(isSensitiveFile("/foo/.env/bar")).toBe(false);
  });

  test("plain `key` and `pem` (no extension) are not flagged", () => {
    expect(isSensitiveFile("/etc/key")).toBe(false);
    expect(isSensitiveFile("/etc/pem")).toBe(false);
  });
});

describe("FILE_READ_COMMANDS", () => {
  test("includes the canonical text-reading commands", () => {
    for (const cmd of ["cat", "head", "tail", "less", "more"]) {
      expect(FILE_READ_COMMANDS).toContain(cmd);
    }
  });

  test("includes binary-dump commands so `xxd .env` is also blocked upstream", () => {
    for (const cmd of ["xxd", "hexdump", "od", "base64"]) {
      expect(FILE_READ_COMMANDS).toContain(cmd);
    }
  });

  test("does NOT include commands that don't read content (ls, stat, etc.)", () => {
    for (const cmd of ["ls", "stat", "echo", "rm", "cp", "grep"]) {
      expect(FILE_READ_COMMANDS).not.toContain(cmd);
    }
  });
});
