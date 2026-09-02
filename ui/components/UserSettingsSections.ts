export type AccountSection = "access" | "office-env" | "invites" | "sessions" | "devices" | "api-tokens" | "signout";

export function buildAccountSections(isOwner: boolean, hasSession: boolean): { section: AccountSection; label: string }[] {
  return [
    ...(isOwner ? [{ section: "access" as const, label: "Access" }] : []),
    ...(isOwner ? [{ section: "office-env" as const, label: "Office variables" }] : []),
    ...(isOwner && hasSession ? [{ section: "invites" as const, label: "Invites" }] : []),
    ...(isOwner && hasSession ? [{ section: "sessions" as const, label: "Sessions" }] : []),
    ...(hasSession ? [{ section: "devices" as const, label: "My devices" }] : []),
    ...(hasSession ? [{ section: "api-tokens" as const, label: "API tokens" }] : []),
    ...(hasSession ? [{ section: "signout" as const, label: "Sign out" }] : []),
  ];
}
