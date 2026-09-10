// Container-only adapter. The private supervisor socket belongs to the
// container entrypoint, so restarting the office does not stop its apps.
// Environment descriptors retain the reconciliation interface used by the
// systemd adapter; these descriptors are metadata, not installed systemd units.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUREAU_DIR } from "../persistence/paths.ts";
import { appHostDomain, appPublicUrl } from "./domain.ts";
import {
  AppSupervisorError,
  APP_HOST_ENV_VAR,
  APP_LOOPBACK_HOST,
  APP_URL_ENV_VAR,
  VITE_ALLOWED_HOST_ENV_VAR,
  appHostEnvDirective,
  appUrlEnvDirective,
  computeAppPath,
  type AppRuntime,
  type AppSupervisor,
} from "./supervisor.ts";
import type { AppRecord } from "../../shared/apps.ts";

const client = fileURLToPath(new URL("../../deploy/render/supervisor.py", import.meta.url));

export function createContainerAppSupervisor(socketPath = join(BUREAU_DIR, "container-runtime", "control.sock"), domain: () => string | null = appHostDomain): AppSupervisor {
  function rpc<T>(op: string, args: Record<string, unknown> = {}): T {
    const reply = spawnSync("python3", [client, "client", socketPath], {
      input: JSON.stringify({ op, ...args }),
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    // Never include stderr, command text, or token-bearing requests in errors.
    if (reply.error || reply.status !== 0) throw new AppSupervisorError("supervisor_failed", "Container supervisor is unavailable");
    let result: { ok: boolean; value?: T; error?: string };
    try {
      result = JSON.parse(reply.stdout);
    } catch {
      throw new AppSupervisorError("supervisor_failed", "Invalid supervisor response");
    }
    if (!result.ok) throw new AppSupervisorError("supervisor_failed", result.error || "Container supervisor refused the operation");
    return result.value as T;
  }
  function definition(app: AppRecord) {
    const url = appPublicUrl(app.hostLabel, domain());
    const env: Record<string, string> = {
      PORT: String(app.port),
      BUREAU_APP_NAME: app.name,
      BUREAU_APP_DATA_DIR: app.dataDir,
      PATH: computeAppPath(app.cwd, dirname(process.execPath)),
    };
    const descriptor = ["# Container app environment descriptor", "[Service]"];
    if (url !== null) {
      env[APP_URL_ENV_VAR] = url;
      env[APP_HOST_ENV_VAR] = APP_LOOPBACK_HOST;
      env[VITE_ALLOWED_HOST_ENV_VAR] = new URL(url).hostname;
      descriptor.push(appUrlEnvDirective(url), appHostEnvDirective(APP_LOOPBACK_HOST));
    }
    return {
      name: app.name,
      command: app.command,
      cwd: app.cwd,
      env,
      descriptor: descriptor.join("\n") + "\n",
    };
  }
  return {
    unitName: (name) => `container-app-${name}`,
    install: (app) => rpc("install", { definition: definition(app) }),
    provisionToken: (name, token) => rpc("token.write", { name, token }),
    readToken: (name) => rpc("token.read", { name }),
    removeToken: (name) => rpc("token.remove", { name }),
    unitInjectsToken: (name) => rpc("exists", { name }),
    readUnitFile: (name) => rpc("descriptor.read", { name }),
    restoreUnitFile: (name, descriptor) => rpc("descriptor.restore", { name, descriptor }),
    reloadUnits: () => {
      rpc("ping");
    },
    regenerate: (app) => rpc("regenerate", { definition: definition(app) }),
    reinstall: (app) => rpc("reinstall", { definition: definition(app) }),
    teardown: (name) => rpc("delete", { name }),
    start: (name) => rpc("start", { name }),
    stop: (name) => rpc("stop", { name }),
    restart: (name) => rpc("restart", { name }),
    states: (names) => new Map(Object.entries(rpc<Record<string, AppRuntime>>("states", { names }))),
    logs: (name, lines) => rpc("logs", { name, lines }),
  };
}
