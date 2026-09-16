import { readFileSync, existsSync } from "fs";
import { DEFAULT_EXPERIMENTAL, type ExperimentalSettings } from "../../../shared/user-types.ts";
import { atomicWriteFileSync, OFFICE_CONFIG_FILE, OFFICE_PROMPT_FILE } from "../paths.ts";

// Office-level settings (prompt + env file path) stored in office-config.json.
// On first load, if the legacy office-prompt.md exists and no config file does,
// fold the .md content into the JSON and leave the .md in place as a one-time backup.
export interface OfficeConfig {
  prompt: string | null;
  envFile: string | null;
  publicOrigin: string | null;
  // External-access toggle. When false, the server binds 127.0.0.1 only and
  // the office is unreachable off-box (a per-process freeze locks cookie
  // attributes and origin policy to the localhost fallback as well). null
  // when the field has never been set on disk — the boot block infers a
  // default from the presence of any publicOrigin source and backfills.
  externalAccess: boolean | null;
  // Deployment-authored listener policy. "auto" keeps the historical rule:
  // bind all interfaces only when external access is enabled. "loopback" lets
  // a local reverse proxy provide outside reachability without exposing the
  // Bureau socket directly. "all" forces a direct-port listener.
  networkBind: "auto" | "loopback" | "all";
  // Display name for this bureau instance, prefixed onto the auth page
  // titles ("<OfficeName> | Bureau — sign in") so owners managing multiple
  // bureau instances can tell them apart at a glance. null falls back to
  // the bare "Bureau — …" title.
  officeName: string | null;
  // Public hostnames that agents may capture with the browser-preview
  // affordance. Preview capture stays private-network-only unless a hostname
  // is explicitly listed here.
  previewAllowHosts: string[];
  /** Opt-in experimental features. Missing on disk → all false. */
  experimental: ExperimentalSettings;
  /** Living agent id for the lobby receptionist click target; null → Team chat. */
  receptionistAgentId: string | null;
}

// A single entry in office-config.json's `enabledPlugins` array.
//
//   - Bare string ("safety-hooks") = a bundled first-party plugin, resolved
//     under `<bureauRoot>/plugins/<id>/`.
//   - Object ({ id, path }) = an external plugin at the explicit `path`. The
//     plugin's exported `id` must match the entry's `id` (the path's basename
//     does NOT have to match — e.g. a plugin could live at a directory called
//     `bureau-dossier` and export id "dossier", but the names don't have to
//     align).
//
// The hybrid shape keeps bundled-plugin config clean (just a string id, no
// machine-specific paths) while making external-plugin trust explicit:
// the config file enumerates every directory whose code will be imported
// into the bureau process.
export type EnabledPluginEntry = string | { id: string; path: string };

export function loadOfficeConfig(): OfficeConfig {
  try {
    if (existsSync(OFFICE_CONFIG_FILE)) {
      const parsed = JSON.parse(readFileSync(OFFICE_CONFIG_FILE, "utf-8")) as Partial<OfficeConfig>;
      return {
        prompt: typeof parsed.prompt === "string" && parsed.prompt ? parsed.prompt : null,
        envFile: typeof parsed.envFile === "string" && parsed.envFile ? parsed.envFile : null,
        publicOrigin: typeof parsed.publicOrigin === "string" && parsed.publicOrigin ? parsed.publicOrigin : null,
        externalAccess: typeof parsed.externalAccess === "boolean" ? parsed.externalAccess : null,
        networkBind: parseNetworkBind(parsed.networkBind),
        officeName: typeof parsed.officeName === "string" && parsed.officeName.trim() ? parsed.officeName.trim().slice(0, 64) : null,
        previewAllowHosts: parsePreviewAllowHosts(parsed.previewAllowHosts),
        experimental: parseExperimental(parsed.experimental),
        receptionistAgentId: parseReceptionistAgentId(parsed.receptionistAgentId),
      };
    }
  } catch (err) {
    console.error("Failed to load office config:", err);
  }
  // Migration: fold legacy office-prompt.md into the config on first load.
  let legacyPrompt: string | null = null;
  try {
    if (existsSync(OFFICE_PROMPT_FILE)) {
      const raw = readFileSync(OFFICE_PROMPT_FILE, "utf-8");
      if (raw.trim()) legacyPrompt = raw;
    }
  } catch {}
  const config: OfficeConfig = {
    prompt: legacyPrompt,
    envFile: null,
    publicOrigin: null,
    externalAccess: null,
    networkBind: "auto",
    officeName: null,
    previewAllowHosts: [],
    experimental: { ...DEFAULT_EXPERIMENTAL },
    receptionistAgentId: null,
  };
  // Only persist if the legacy prompt actually had content — otherwise a fresh
  // install touches a new file for no reason, and the next save/set will write
  // it anyway once there's real data.
  if (legacyPrompt) {
    try {
      atomicWriteFileSync(OFFICE_CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (err) {
      console.error("Failed to write initial office config:", err);
    }
  }
  return config;
}

export function saveOfficeConfig(config: OfficeConfig) {
  try {
    atomicWriteFileSync(OFFICE_CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("Failed to save office config:", err);
  }
}

export function normalizePreviewAllowHosts(value: string[]): string[] {
  const seen = new Set<string>();
  const hosts: string[] = [];
  for (const raw of value) {
    const host = raw.trim().toLowerCase().replace(/\.$/u, "");
    if (!host || seen.has(host)) continue;
    if (!isValidPreviewAllowHost(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts.slice(0, 50);
}

export function isValidPreviewAllowHost(host: string): boolean {
  if (host.length > 253) return false;
  if (host === "localhost") return true;
  if (/^\d+\.\d+\.\d+\.\d+$/u.test(host)) return true;
  return host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
}

function parsePreviewAllowHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return normalizePreviewAllowHosts(value.filter((item): item is string => typeof item === "string"));
}

function parseNetworkBind(value: unknown): "auto" | "loopback" | "all" {
  if (value === undefined || value === null) return "auto";
  if (value === "auto" || value === "loopback" || value === "all") return value;
  console.error('[office-config] networkBind in office-config.json must be "auto", "loopback", or "all"; using auto');
  return "auto";
}

export function parseExperimental(value: unknown): ExperimentalSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_EXPERIMENTAL };
  const raw = value as { browserPanel?: unknown };
  return { browserPanel: raw.browserPanel === true };
}

export function normalizeExperimental(value: unknown): ExperimentalSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { browserPanel?: unknown };
  if (typeof raw.browserPanel !== "boolean") return null;
  return { browserPanel: raw.browserPanel };
}

export function parseReceptionistAgentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id || null;
}

/** Accepts string id, null, or omit-invalid → null. Empty string clears. */
export function normalizeReceptionistAgentId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id || null;
}

// Raw read of office-config.json — returns the parsed object verbatim without
// filtering unknown keys. Used by loadEnabledPlugins so fields the OfficeConfig
// shape doesn't know about (like `enabledPlugins`) survive the round trip.
function readOfficeConfigRaw(): Record<string, unknown> {
  try {
    if (existsSync(OFFICE_CONFIG_FILE)) {
      return JSON.parse(readFileSync(OFFICE_CONFIG_FILE, "utf-8")) as Record<string, unknown>;
    }
  } catch (err) {
    console.error("Failed to read office config (raw):", err);
  }
  return {};
}

// Read `enabledPlugins` from office-config.json. Returns validated entries
// (deduped by id, first occurrence wins). Goes through readOfficeConfigRaw
// rather than loadOfficeConfig because `OfficeConfig` filters unknown keys
// — `enabledPlugins` lives alongside `prompt` / `envFile` / `officeName` /
// `publicOrigin` in the JSON but is not surfaced to the UI in v0 (operator
// edits the file directly).
//
// Validation:
// - Top-level must be an array; otherwise the field is dropped wholesale.
// - String entries must match `[a-z0-9_-]+`.
// - Object entries must have `id: string` matching the same regex AND
//   `path: string` that's absolute (starts with `/`) or tilde-prefixed
//   (starts with `~/`). Relative paths are rejected because they'd resolve
//   against the server cwd which is brittle.
// - Bad entries are logged to stderr and dropped — a malformed enable list
//   should not silently broaden the trust boundary.
export function loadEnabledPlugins(): EnabledPluginEntry[] {
  const raw = readOfficeConfigRaw();
  if (!("enabledPlugins" in raw)) return [];
  const candidate = raw.enabledPlugins;
  if (!Array.isArray(candidate)) {
    console.error("[office-config] enabledPlugins in office-config.json is not an array; ignoring");
    return [];
  }
  const idRe = /^[a-z0-9_-]+$/;
  const result: EnabledPluginEntry[] = [];
  const seenIds = new Set<string>();
  for (const v of candidate) {
    let entry: EnabledPluginEntry | null = null;
    if (typeof v === "string") {
      const id = v.trim();
      if (!idRe.test(id)) {
        console.error(`[office-config] enabledPlugins entry "${v}" is not a valid plugin id (need ${idRe}); ignoring`);
        continue;
      }
      entry = id;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as { id?: unknown; path?: unknown };
      const rawId = typeof obj.id === "string" ? obj.id.trim() : "";
      if (!rawId || !idRe.test(rawId)) {
        console.error(`[office-config] enabledPlugins object entry has invalid id (need ${idRe}); ignoring:`, v);
        continue;
      }
      const rawPath = typeof obj.path === "string" ? obj.path.trim() : "";
      if (!rawPath) {
        console.error(`[office-config] enabledPlugins object entry "${rawId}" is missing path; ignoring`);
        continue;
      }
      if (!rawPath.startsWith("/") && !rawPath.startsWith("~/")) {
        console.error(`[office-config] enabledPlugins entry "${rawId}" path "${rawPath}" is not absolute (must start with / or ~/); ignoring`);
        continue;
      }
      entry = { id: rawId, path: rawPath };
    } else {
      console.error("[office-config] enabledPlugins entry is neither a string nor an {id, path} object; ignoring:", v);
      continue;
    }
    const id = typeof entry === "string" ? entry : entry.id;
    if (seenIds.has(id)) {
      console.error(`[office-config] enabledPlugins has duplicate id "${id}"; keeping the first occurrence`);
      continue;
    }
    seenIds.add(id);
    result.push(entry);
  }
  return result;
}
