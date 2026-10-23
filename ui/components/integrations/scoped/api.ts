import type { PlainMessageKey, Translator } from "../../../../shared/i18n/translate.ts";
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
  if (!response.ok) {
    if (result.error) throw new Error(result.error);
    throw new IntegrationRequestError();
  }
  return result as T;
}

class IntegrationRequestError extends Error {
  constructor() {
    super("The integration request failed.");
  }
}
export type IntegrationFailure = string | { key: PlainMessageKey };
export function integrationFailure(error: unknown, fallback: PlainMessageKey): IntegrationFailure {
  return error instanceof IntegrationRequestError ? { key: "integrations.requestFailed" } : error instanceof Error ? error.message : { key: fallback };
}
export function integrationFailureText(error: IntegrationFailure, t: Translator["t"]): string {
  return typeof error === "string" ? error : t(error.key);
}
