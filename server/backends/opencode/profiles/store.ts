import { BureauLogError } from "../../../../shared/i18n/backend-errors/error.ts";
import { logMessage } from "../../../../shared/i18n/log-message.ts";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BUREAU_DIR } from "../../../persistence/paths.ts";
import { profileKey } from "./identity.ts";

export interface SessionProfile {
  sessionId: string;
  environmentId: string;
  profile: string;
  cwd: string;
  model: string;
  agent?: string;
}

export class OpenCodeProfileStore {
  constructor(readonly root = join(BUREAU_DIR, "opencode")) {}

  profileDir(profile: string): string {
    if (profile !== "default" && !/^[a-f0-9]{64}$/.test(profile)) throw new BureauLogError(logMessage("logs.backendError.profileInvalid"));
    return join(this.root, "profiles", profile);
  }

  read(sessionId: string): SessionProfile | null {
    let text: string;
    try {
      text = readFileSync(this.bindingPath(sessionId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const value = JSON.parse(text) as SessionProfile;
    if (
      value.sessionId !== sessionId ||
      typeof value.environmentId !== "string" ||
      typeof value.cwd !== "string" ||
      typeof value.model !== "string" ||
      (value.agent !== undefined && typeof value.agent !== "string")
    ) {
      throw new BureauLogError(logMessage("logs.backendError.bindingInvalid"));
    }
    this.profileDir(value.profile);
    return value;
  }

  write(binding: SessionProfile): void {
    this.profileDir(binding.profile);
    const previous = this.read(binding.sessionId);
    if (previous && (previous.profile !== binding.profile || previous.environmentId !== binding.environmentId)) {
      throw new BureauLogError(logMessage("logs.backendError.environmentMismatch"));
    }
    const dir = join(this.root, "session-bindings");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const target = this.bindingPath(binding.sessionId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(binding) + "\n", { mode: 0o600, flag: "wx" });
      renameSync(temporary, target);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  private bindingPath(sessionId: string): string {
    if (!sessionId || sessionId.length > 512) throw new BureauLogError(logMessage("logs.backendError.sessionInvalid"));
    return join(this.root, "session-bindings", `${profileKey(sessionId)}.json`);
  }
}
