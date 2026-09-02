import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { UserRecord } from "../../../shared/types.ts";
import { migrateManagedEnvAtBoot } from "../session/managed-env-migration.ts";
import { parseDotenv, readEnvFile } from "../../persistence/env-file.ts";
import { serializeManagedEnv } from "../../persistence/managed-env.ts";

const USER_ID = "migration-user";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function user(path: string | null): UserRecord {
  return {
    id: USER_ID,
    name: "Migration User",
    role: "member",
    envFile: path,
    memberPrompt: null,
    language: null,
    slideMode: false,
    allowedRooms: [],
    hidden: [],
    order: [],
    defaultRoomId: null,
    notifRooms: [],
    avatarColor: "#000000",
    avatarVariant: "classic",
    createdAt: 1,
  };
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bureau-managed-env-migration-"));
  roots.push(root);
  return root;
}

function managedStore(root: string) {
  const officePath = join(root, "managed", "office.env");
  const userPath = join(root, "managed", `${USER_ID}.env`);
  const read = (path: string) => (existsSync(path) ? parseDotenv(readFileSync(path, "utf8")) : {});
  const write = (path: string, values: Record<string, string>) => {
    mkdirSync(join(root, "managed"), { recursive: true });
    writeFileSync(path, serializeManagedEnv(values));
  };
  return {
    officePath,
    userPath,
    managedOfficeEnvExists: () => existsSync(officePath),
    managedUserEnvExists: () => existsSync(userPath),
    readManagedOfficeEnv: () => read(officePath),
    readManagedUserEnv: () => read(userPath),
    writeManagedOfficeEnv: (values: Record<string, string>) => write(officePath, values),
    writeManagedUserEnv: (values: Record<string, string>) => write(userPath, values),
  };
}

describe("managed env boot migration", () => {
  test("imports office and user values once through the real parser", () => {
    const root = fixtureRoot();
    const store = managedStore(root);
    const fixtures = join(root, "legacy");
    mkdirSync(fixtures, { recursive: true });
    const officePath = join(fixtures, "office.env");
    const userPath = join(fixtures, "user.env");
    writeFileSync(officePath, "GH_TOKEN=office\nTRAILING='office value '\n");
    writeFileSync(userPath, "GH_TOKEN=\"user's token\"\nTRAILING='user value '\n");
    let officeLegacy: string | null = officePath;
    const record = user(userPath);
    let reads = 0;

    const deps = {
      office: {
        label: "office variables",
        get path() {
          return officeLegacy;
        },
        legacyExists: existsSync,
        managedExists: store.managedOfficeEnvExists,
        readManaged: store.readManagedOfficeEnv,
        readLegacy: (path: string) => {
          reads++;
          return readEnvFile(path);
        },
        writeManaged: store.writeManagedOfficeEnv,
        clearLegacyPath: () => {
          officeLegacy = null;
        },
      },
      users: [record],
      userSubject: () => ({
        label: `user "${record.name}"`,
        get path() {
          return record.envFile;
        },
        legacyExists: existsSync,
        managedExists: store.managedUserEnvExists,
        readManaged: store.readManagedUserEnv,
        readLegacy: (path: string) => {
          reads++;
          return readEnvFile(path);
        },
        writeManaged: store.writeManagedUserEnv,
        clearLegacyPath: () => {
          record.envFile = null;
        },
      }),
      log: () => {},
    };

    migrateManagedEnvAtBoot(deps);
    expect(store.readManagedOfficeEnv()).toEqual({ GH_TOKEN: "office", TRAILING: "office value " });
    expect(store.readManagedUserEnv()).toEqual({ GH_TOKEN: "user's token", TRAILING: "user value " });
    expect(reads).toBe(2);

    migrateManagedEnvAtBoot(deps);
    expect(reads).toBe(2);
  });

  test("continues after failures without logging secret material", () => {
    const root = fixtureRoot();
    const store = managedStore(root);
    const fixtures = join(root, "legacy");
    mkdirSync(fixtures, { recursive: true });
    const badPath = join(fixtures, "bad-key.env");
    writeFileSync(badPath, "BAD-KEY=secret-value\n");
    const record = user(badPath);
    const logs: string[] = [];

    expect(() =>
      migrateManagedEnvAtBoot({
        office: {
          label: "office variables",
          path: null,
          legacyExists: existsSync,
          managedExists: store.managedOfficeEnvExists,
          readManaged: store.readManagedOfficeEnv,
          readLegacy: readEnvFile,
          writeManaged: store.writeManagedOfficeEnv,
          clearLegacyPath: () => {},
        },
        users: [record],
        userSubject: () => ({
          label: `user "${record.name}"`,
          get path() {
            return record.envFile;
          },
          legacyExists: existsSync,
          managedExists: store.managedUserEnvExists,
          readManaged: store.readManagedUserEnv,
          readLegacy: readEnvFile,
          writeManaged: store.writeManagedUserEnv,
          clearLegacyPath: () => {
            record.envFile = null;
          },
        }),
        log: (message) => logs.push(message),
      }),
    ).not.toThrow();

    expect(record.envFile).toBe(badPath);
    expect(logs).toEqual(['[managed env migration] could not import user "Migration User"; retrying on next boot']);
    expect(logs.join("\n")).not.toContain("secret");
  });

  test("clears missing legacy paths instead of retrying forever", () => {
    const root = fixtureRoot();
    const store = managedStore(root);
    const missing = join(root, "legacy", "missing.env");
    const record = user(missing);
    const logs: string[] = [];

    migrateManagedEnvAtBoot({
      office: {
        label: "office variables",
        path: null,
        legacyExists: existsSync,
        managedExists: store.managedOfficeEnvExists,
        readManaged: store.readManagedOfficeEnv,
        readLegacy: readEnvFile,
        writeManaged: store.writeManagedOfficeEnv,
        clearLegacyPath: () => {},
      },
      users: [record],
      userSubject: () => ({
        label: `user "${record.name}"`,
        get path() {
          return record.envFile;
        },
        legacyExists: existsSync,
        managedExists: store.managedUserEnvExists,
        readManaged: store.readManagedUserEnv,
        readLegacy: readEnvFile,
        writeManaged: store.writeManagedUserEnv,
        clearLegacyPath: () => {
          record.envFile = null;
        },
      }),
      log: (message) => logs.push(message),
    });

    expect(record.envFile).toBeNull();
    expect(logs).toEqual(['[managed env migration] cleared missing env file for user "Migration User"']);
  });

  test("does not overwrite different managed values and clears identical retries", () => {
    const root = fixtureRoot();
    const store = managedStore(root);
    const fixtures = join(root, "legacy");
    mkdirSync(fixtures, { recursive: true });
    const legacy = join(fixtures, "user.env");
    writeFileSync(legacy, "GH_TOKEN=legacy\n");
    const record = user(legacy);
    store.writeManagedUserEnv({ GH_TOKEN: "managed" });
    const logs: string[] = [];

    const run = () =>
      migrateManagedEnvAtBoot({
        office: {
          label: "office variables",
          path: null,
          legacyExists: existsSync,
          managedExists: store.managedOfficeEnvExists,
          readManaged: store.readManagedOfficeEnv,
          readLegacy: readEnvFile,
          writeManaged: store.writeManagedOfficeEnv,
          clearLegacyPath: () => {},
        },
        users: [record],
        userSubject: () => ({
          label: `user "${record.name}"`,
          get path() {
            return record.envFile;
          },
          legacyExists: existsSync,
          managedExists: store.managedUserEnvExists,
          readManaged: store.readManagedUserEnv,
          readLegacy: readEnvFile,
          writeManaged: store.writeManagedUserEnv,
          clearLegacyPath: () => {
            record.envFile = null;
          },
        }),
        log: (message) => logs.push(message),
      });

    run();
    expect(record.envFile).toBe(legacy);
    expect(logs).toEqual(['[managed env migration] could not import user "Migration User"; retrying on next boot']);

    store.writeManagedUserEnv({ GH_TOKEN: "legacy" });
    run();
    expect(record.envFile).toBeNull();
  });
});
