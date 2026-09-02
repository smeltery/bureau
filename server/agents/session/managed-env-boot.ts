import { readEnvFile } from "../../persistence.ts";
import { officeConfig, roomsWire } from "../state.ts";
import { setOfficeSettings } from "../rooms.ts";
import { listUsers, updateUserById } from "../../users.ts";
import {
  managedOfficeEnvExists,
  managedOfficeEnvPath,
  managedUserEnvExists,
  managedUserEnvPath,
  readManagedOfficeEnv,
  readManagedUserEnv,
  writeManagedOfficeEnv,
  writeManagedUserEnv,
} from "../../persistence/managed-env.ts";
import { legacyEnvFileExists, migrateManagedEnvAtBoot } from "./managed-env-migration.ts";

export function migrateLegacyManagedEnv(): void {
  migrateManagedEnvAtBoot({
    office: {
      label: "office variables",
      get path() {
        return officeConfig.envFile;
      },
      isManagedPath: (path) => path === managedOfficeEnvPath(),
      legacyExists: legacyEnvFileExists,
      managedExists: managedOfficeEnvExists,
      readManaged: readManagedOfficeEnv,
      readLegacy: readEnvFile,
      writeManaged: writeManagedOfficeEnv,
      clearLegacyPath: () => setOfficeSettings(officeConfig.prompt, null),
      useManagedPath: () => setOfficeSettings(officeConfig.prompt, managedOfficeEnvPath()),
    },
    users: listUsers(roomsWire()),
    userSubject: (user) => ({
      label: `user "${user.name}"`,
      get path() {
        return user.envFile;
      },
      isManagedPath: (path) => path === managedUserEnvPath(user.id),
      legacyExists: legacyEnvFileExists,
      managedExists: () => managedUserEnvExists(user.id),
      readManaged: () => readManagedUserEnv(user.id),
      readLegacy: readEnvFile,
      writeManaged: (values) => writeManagedUserEnv(user.id, values),
      clearLegacyPath: () => {
        const result = updateUserById(user.id, { envFile: null });
        if (result.ok) user.envFile = result.user.envFile;
      },
      useManagedPath: () => {
        const result = updateUserById(user.id, { envFile: managedUserEnvPath(user.id) });
        if (result.ok) user.envFile = result.user.envFile;
      },
    }),
    log: (message) => console.warn(message),
  });
}
