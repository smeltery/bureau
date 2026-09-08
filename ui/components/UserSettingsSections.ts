export type AccountSection = "access" | "connections" | "office-env" | "personal-env" | "usage" | "storage" | "invites" | "sessions" | "devices" | "api-tokens" | "signout";

export function buildAccountSections(isOwner: boolean, hasSession: boolean): { section: AccountSection; label: string }[] {
  return [
    ...(isOwner ? [{ section: "access" as const, label: "Access" }] : []),
    // Provider status + API-key paste for Claude/Codex (signed-in user scope).
    ...(hasSession ? [{ section: "connections" as const, label: "Connections" }] : []),
    ...(isOwner ? [{ section: "office-env" as const, label: "Office variables" }] : []),
    // Personal managed env — any signed-in user can edit their own
    // (`GET/PUT /api/users/:name/env`). Distinct from provider Connections sign-in.
    ...(hasSession ? [{ section: "personal-env" as const, label: "Variables" }] : []),
    // Usage is available to any signed-in user (scoped server-side). Storage prune
    // stays owner-only, matching GET/POST /api/storage/*.
    ...(hasSession ? [{ section: "usage" as const, label: "Usage" }] : []),
    ...(isOwner && hasSession ? [{ section: "storage" as const, label: "Storage" }] : []),
    ...(isOwner && hasSession ? [{ section: "invites" as const, label: "Invites" }] : []),
    ...(isOwner && hasSession ? [{ section: "sessions" as const, label: "Sessions" }] : []),
    ...(hasSession ? [{ section: "devices" as const, label: "My devices" }] : []),
    ...(hasSession ? [{ section: "api-tokens" as const, label: "API tokens" }] : []),
    ...(hasSession ? [{ section: "signout" as const, label: "Sign out" }] : []),
  ];
}
