import { readFileSync, existsSync } from "fs";
import { atomicWriteFileSync, OFFICE_CONFIG_FILE, OFFICE_PROMPT_FILE } from "../paths.ts";

// Office-level settings (prompt + env file path) stored in office-config.json.
// On first load, if the legacy office-prompt.md exists and no config file does,
// fold the .md content into the JSON and leave the .md in place as a one-time backup.
export interface OfficeConfig {
  prompt: string | null;
  envFile: string | null;
}

export function loadOfficeConfig(): OfficeConfig {
  try {
    if (existsSync(OFFICE_CONFIG_FILE)) {
      const parsed = JSON.parse(readFileSync(OFFICE_CONFIG_FILE, "utf-8")) as Partial<OfficeConfig>;
      return {
        prompt: typeof parsed.prompt === "string" && parsed.prompt ? parsed.prompt : null,
        envFile: typeof parsed.envFile === "string" && parsed.envFile ? parsed.envFile : null,
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
  const config: OfficeConfig = { prompt: legacyPrompt, envFile: null };
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
