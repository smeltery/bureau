export const INTEGRATION_TABS = ["Providers", "Browser", "Voice", "MCP", "Secrets", "Variables"] as const;
export type IntegrationTab = (typeof INTEGRATION_TABS)[number];

export function integrationTabForPath(path: string): IntegrationTab | null {
  const normalized = path.replace(/\/+$/, "");
  if (normalized === "/integrations") return "Providers";
  return INTEGRATION_TABS.find((tab) => normalized === `/integrations/${tab.toLowerCase()}`) ?? null;
}

export function integrationPath(tab: IntegrationTab): string {
  return `/integrations/${tab.toLowerCase()}`;
}
