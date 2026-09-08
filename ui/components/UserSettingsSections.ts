import type { MessageKey, PlainMessageKey } from "../../shared/i18n/translate.ts";

export type AccountSection = "access" | "connections" | "office-env" | "personal-env" | "usage" | "storage" | "invites" | "sessions" | "devices" | "api-tokens" | "signout";

export const ACCOUNT_SECTION_LABEL_KEYS: Record<AccountSection, PlainMessageKey> = {
  access: "settings.sidebar.access",
  connections: "settings.sidebar.connections",
  "office-env": "settings.sidebar.officeEnv",
  "personal-env": "settings.sidebar.personalEnv",
  usage: "settings.sidebar.usage",
  storage: "settings.sidebar.storage",
  invites: "settings.sidebar.invites",
  sessions: "settings.sidebar.sessions",
  devices: "settings.sidebar.devices",
  "api-tokens": "settings.sidebar.apiTokens",
  signout: "settings.sidebar.signOut",
};

export function buildAccountSections(isOwner: boolean, hasSession: boolean): { section: AccountSection; labelKey: PlainMessageKey }[] {
  return [
    ...(isOwner ? [{ section: "access" as const, labelKey: ACCOUNT_SECTION_LABEL_KEYS.access }] : []),
    // Provider status + API-key paste for Claude/Codex (signed-in user scope).
    ...(hasSession ? [{ section: "connections" as const, labelKey: ACCOUNT_SECTION_LABEL_KEYS.connections }] : []),
    ...(isOwner ? [{ section: "office-env" as const, labelKey: ACCOUNT_SECTION_LABEL_KEYS["office-env"] }] : []),
    // Personal managed env — any signed-in user can edit their own
    // (`GET/PUT /api/users/:name/env`). Distinct from provider Connections sign-in.
    ...(hasSession ? [{ section: "personal-env" as const, labelKey: ACCOUNT_SECTION_LABEL_KEYS["personal-env"] }] : []),
    // Usage is available to any signed-in user (scoped server-side). Storage prune
    // stays owner-only, matching GET/POST /api/storage/*.
    ...(hasSession ? [{ section: "usage" as const, labelKey: ACCOUNT_SECTION_LABEL_KEYS.usage }] : []),
    ...(isOwner && hasSession ? [{ section: "storage" as const, labelKey: ACCOUNT_SECTION_LABEL_KEYS.storage }] : []),
    ...(isOwner && hasSession ? [{ section: "invites" as const, labelKey: ACCOUNT_SECTION_LABEL_KEYS.invites }] : []),
    ...(isOwner && hasSession ? [{ section: "sessions" as const, labelKey: ACCOUNT_SECTION_LABEL_KEYS.sessions }] : []),
    ...(hasSession ? [{ section: "devices" as const, labelKey: ACCOUNT_SECTION_LABEL_KEYS.devices }] : []),
    ...(hasSession ? [{ section: "api-tokens" as const, labelKey: ACCOUNT_SECTION_LABEL_KEYS["api-tokens"] }] : []),
    ...(hasSession ? [{ section: "signout" as const, labelKey: ACCOUNT_SECTION_LABEL_KEYS.signout }] : []),
  ];
}
