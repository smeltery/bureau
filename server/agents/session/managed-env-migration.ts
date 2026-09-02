import { statSync } from "fs";
import type { UserRecord } from "../../../shared/types.ts";

export function legacyEnvFileExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export interface LegacyEnvSubject {
  label: string;
  path: string | null;
  legacyExists(path: string): boolean;
  managedExists(): boolean;
  readManaged(): Record<string, string> | null;
  readLegacy(path: string): Record<string, string>;
  writeManaged(values: Record<string, string>): void;
  clearLegacyPath(): void;
}

export interface ManagedEnvMigrationDeps {
  office: LegacyEnvSubject;
  users: UserRecord[];
  userSubject(user: UserRecord): LegacyEnvSubject;
  log(message: string): void;
}

export function migrateManagedEnvAtBoot(deps: ManagedEnvMigrationDeps): void {
  migrateSubject(deps.office, deps.log);
  for (const user of deps.users) migrateSubject(deps.userSubject(user), deps.log);
}

function migrateSubject(subject: LegacyEnvSubject, log: (message: string) => void): void {
  if (!subject.path) return;
  try {
    if (!subject.legacyExists(subject.path)) {
      subject.clearLegacyPath();
      log(`[managed env migration] cleared missing env file for ${subject.label}`);
      return;
    }

    const values = subject.readLegacy(subject.path);
    if (subject.managedExists()) {
      if (sorted(subject.readManaged()) !== sorted(values)) {
        throw new Error("managed env already exists");
      }
      subject.clearLegacyPath();
      return;
    }

    subject.writeManaged(values);
    subject.clearLegacyPath();
  } catch {
    log(`[managed env migration] could not import ${subject.label}; retrying on next boot`);
  }
}

function sorted(record: Record<string, string> | null): string {
  return JSON.stringify(Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}
