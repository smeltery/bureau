import type { CreateSessionOptions, SessionAccessOptions } from "../../types.ts";
import { OpenCodeSupervisor } from "../supervisor.ts";
import { DEFAULT_OPENCODE_MODEL, permissionAgent } from "../config.ts";
import { OpenCodeProfileStore, type SessionProfile } from "./store.ts";
import { openCodeEnvironmentId, profileKey } from "./identity.ts";

export type ProfileBinding = Omit<SessionProfile, "sessionId"> & {
  supervisor: OpenCodeSupervisor;
  resolveEnv: () => Record<string, string | undefined> | undefined;
};
const supervisors = new Map<string, OpenCodeSupervisor>();

export class OpenCodeProfiles {
  private bindings = new Map<string, ProfileBinding>();
  constructor(
    private readonly store: OpenCodeProfileStore | null = new OpenCodeProfileStore(),
    private readonly factory: (path: string) => OpenCodeSupervisor = (profileDir) => {
      let supervisor = supervisors.get(profileDir);
      if (!supervisor) {
        supervisor = new OpenCodeSupervisor({ profileDir });
        supervisors.set(profileDir, supervisor);
      }
      return supervisor;
    },
  ) {}

  select(opts: Pick<CreateSessionOptions, "cwd" | "env" | "environmentId" | "resolveEnv">, model: string, agent?: string, sessionId?: string): ProfileBinding {
    const environmentId = opts.environmentId ?? openCodeEnvironmentId();
    const stored = sessionId ? this.store?.read(sessionId) : null;
    if (stored && stored.environmentId !== environmentId) throw new Error("OpenCode session belongs to another manager or room. Return to that environment or start a new conversation.");
    // Untagged historical sessions stay in the old store; never copy its DB or auth.
    const profile = stored?.profile ?? (sessionId ? "default" : profileKey(environmentId));
    return { environmentId, profile, cwd: opts.cwd, model, agent, supervisor: this.factory(this.store?.profileDir(profile) ?? profile), resolveEnv: opts.resolveEnv ?? (() => opts.env) };
  }

  bind(sessionId: string, binding: ProfileBinding): void {
    this.store?.write({ sessionId, environmentId: binding.environmentId, profile: binding.profile, cwd: binding.cwd, model: binding.model, agent: binding.agent });
    this.bindings.set(sessionId, binding);
  }

  access(sessionId: string, access?: SessionAccessOptions): ProfileBinding {
    const live = this.bindings.get(sessionId);
    if (!access && live) return live;
    if (!access) throw new Error("OpenCode session access requires its manager and room environment.");
    const stored = this.store?.read(sessionId);
    const binding = this.select(access, stored?.model ?? live?.model ?? DEFAULT_OPENCODE_MODEL, stored?.agent ?? live?.agent, sessionId);
    this.bind(sessionId, binding);
    return binding;
  }

  session(opts: CreateSessionOptions, model: string, sessionId?: string): ProfileBinding {
    const binding = this.select(opts, model, permissionAgent(opts.permissionMode), sessionId);
    if (sessionId) this.bind(sessionId, binding);
    return binding;
  }
}
