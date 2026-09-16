import { normalizePublicOrigin } from "../shared/public-origin.ts";
import { loadOfficeConfig, saveOfficeConfig } from "./persistence.ts";
import { freezeBootState, setOfficeName, setPublicOriginFallback } from "./auth/auth.ts";

// Resolve access settings, migrate the deprecated env var, backfill
// externalAccess to disk, then freeze cookie/origin and listener-bind state for
// this process.
export function initializeAccessConfig(): void {
  let cfg = loadOfficeConfig();
  const envRaw = process.env.BUREAU_PUBLIC_ORIGIN?.trim();
  const envOrigin = envRaw ? normalizePublicOrigin(envRaw) : null;

  let configDirty = false;
  if (envOrigin) {
    if (cfg.publicOrigin === null) {
      console.log(
        `[auth] BUREAU_PUBLIC_ORIGIN is deprecated. Migrating "${envOrigin}" into office-config.json so it survives without the env var. Remove BUREAU_PUBLIC_ORIGIN from your env on your next deploy.`,
      );
      cfg = { ...cfg, publicOrigin: envOrigin };
      configDirty = true;
    } else if (cfg.publicOrigin === envOrigin) {
      console.log(`[auth] BUREAU_PUBLIC_ORIGIN env var is redundant with office-config.json#publicOrigin (${cfg.publicOrigin}) and is deprecated. Remove it from your env on your next deploy.`);
    } else {
      console.error(
        `[auth] BUREAU_PUBLIC_ORIGIN ("${envOrigin}") differs from office-config.json#publicOrigin ("${cfg.publicOrigin}"). The env var is deprecated; bureau uses the env value for THIS boot but will use the JSON value once the env var is removed. Reconcile by editing one and removing the other.`,
      );
    }
  }

  let externalAccess: boolean;
  if (cfg.externalAccess !== null) {
    externalAccess = cfg.externalAccess;
  } else {
    externalAccess = cfg.publicOrigin !== null || envOrigin !== null;
    configDirty = true;
  }

  if (configDirty) {
    try {
      saveOfficeConfig({
        prompt: cfg.prompt,
        envFile: cfg.envFile,
        publicOrigin: cfg.publicOrigin,
        externalAccess,
        networkBind: cfg.networkBind,
        officeName: cfg.officeName,
        previewAllowHosts: cfg.previewAllowHosts,
        experimental: cfg.experimental,
        receptionistAgentId: cfg.receptionistAgentId,
      });
    } catch (err) {
      console.error(`[auth] failed to backfill office-config.json (${(err as Error).message}); will re-attempt next boot`);
    }
  }

  setPublicOriginFallback(cfg.publicOrigin);
  setOfficeName(cfg.officeName);
  freezeBootState({ externalAccess, networkBind: cfg.networkBind });
  if (cfg.networkBind === "loopback") {
    console.log('[network] networkBind="loopback": office listener uses 127.0.0.1. Set networkBind to "all" for direct-port access.');
  }
}

export function boundExternal(): boolean {
  const cfg = loadOfficeConfig();
  if (cfg.externalAccess === false) return false;
  if (cfg.externalAccess === true) return true;
  return cfg.publicOrigin !== null || !!process.env.BUREAU_PUBLIC_ORIGIN;
}
