export type AccountSection = "access" | "sessions" | "devices" | "signout";

export function buildAccountSections(isOwner: boolean, hasSession: boolean): { section: AccountSection; label: string }[] {
  return [
    ...(isOwner ? [{ section: "access" as const, label: "Access" }] : []),
    ...(isOwner && hasSession ? [{ section: "sessions" as const, label: "Sessions" }] : []),
    ...(hasSession ? [{ section: "devices" as const, label: "My devices" }] : []),
    ...(hasSession ? [{ section: "signout" as const, label: "Sign out" }] : []),
  ];
}
