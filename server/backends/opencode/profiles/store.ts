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
    if (profile !== "default" && !/^[a-f0-9]{64}$/.test(profile)) throw new Error("Invalid OpenCode profile identity.");
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
      throw new Error("OpenCode session binding is invalid; refusing to select a different history store.");
    }
    this.profileDir(value.profile);
    return value;
  }

  write(binding: SessionProfile): void {
    this.profileDir(binding.profile);
    const previous = this.read(binding.sessionId);
    if (previous && (previous.profile !== binding.profile || previous.environmentId !== binding.environmentId)) {
      throw new Error("OpenCode session belongs to another environment. Return to that environment or start a new conversation.");
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
    if (!sessionId || sessionId.length > 512) throw new Error("Invalid OpenCode session identity.");
    return join(this.root, "session-bindings", `${profileKey(sessionId)}.json`);
  }
}
