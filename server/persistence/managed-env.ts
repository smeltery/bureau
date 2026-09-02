import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { BUREAU_DIR } from "./paths.ts";
import { parseDotenv } from "./env-file.ts";

const USER_ENV_DIR = join(BUREAU_DIR, "user-env");
const OFFICE_ENV_DIR = join(BUREAU_DIR, "office-env");
const OFFICE_ENV_FILE = join(OFFICE_ENV_DIR, "office.env");
const SAFE_USER_ID = /^[A-Za-z0-9_-]+$/;
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ManagedEnvValues = Record<string, string>;

export class ManagedEnvValidationError extends Error {}

export function managedUserEnvPath(userId: string): string {
  if (!SAFE_USER_ID.test(userId)) throw new ManagedEnvValidationError("invalid user id");
  return join(USER_ENV_DIR, `${userId}.env`);
}

export function managedOfficeEnvPath(): string {
  return OFFICE_ENV_FILE;
}

export function readManagedUserEnv(userId: string): ManagedEnvValues {
  const path = managedUserEnvPath(userId);
  return existsSync(path) ? parseDotenv(readFileSync(path, "utf8")) : {};
}

export function managedUserEnvExists(userId: string): boolean {
  return existsSync(managedUserEnvPath(userId));
}

export function readManagedOfficeEnv(): ManagedEnvValues {
  return existsSync(OFFICE_ENV_FILE) ? parseDotenv(readFileSync(OFFICE_ENV_FILE, "utf8")) : {};
}

export function managedOfficeEnvExists(): boolean {
  return existsSync(OFFICE_ENV_FILE);
}

export function serializeManagedEnv(values: ManagedEnvValues): string {
  validate(values);
  return Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}='${value}'`)
    .join("\n")
    .concat(Object.keys(values).length > 0 ? "\n" : "");
}

export function writeManagedUserEnv(userId: string, values: ManagedEnvValues): void {
  writeManagedEnv(USER_ENV_DIR, managedUserEnvPath(userId), userId, values);
}

export function writeManagedOfficeEnv(values: ManagedEnvValues): void {
  writeManagedEnv(OFFICE_ENV_DIR, OFFICE_ENV_FILE, "office", values);
}

function validate(values: ManagedEnvValues): void {
  for (const [key, value] of Object.entries(values)) {
    if (!SAFE_KEY.test(key) || key === "__proto__") throw new ManagedEnvValidationError(`invalid environment key: ${key}`);
    if (typeof value !== "string") throw new ManagedEnvValidationError(`value for ${key} must be a string`);
    if (
      [...value].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 8 || (code >= 10 && code <= 31) || code === 127;
      })
    ) {
      throw new ManagedEnvValidationError(`value for ${key} contains an unsupported control character`);
    }
  }
}

function writeManagedEnv(directory: string, path: string, tempName: string, values: ManagedEnvValues): void {
  const content = serializeManagedEnv(values);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temp = join(directory, `.${tempName}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let fd: number | null = null;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temp, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(temp, { force: true });
  }
}
