import type { SecretMetadata, RemoteMcpServer } from "../../../../shared/integrations/connections.ts";
export interface IntegrationListing {
  secrets: SecretMetadata[];
  mcp: RemoteMcpServer[];
  variables: { name: string; value?: string }[];
  canManage: boolean;
  canReveal: boolean;
}
export async function integrationApi<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The integration request failed.");
  return result as T;
}
