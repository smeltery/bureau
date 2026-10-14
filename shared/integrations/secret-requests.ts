import type { IntegrationScope, SecretForm } from "./connections.ts";
export interface SecretRequestCard {
  id: string;
  agentId: string;
  name: string;
  hosts: string[];
  form: SecretForm;
  reason: string;
  scope: IntegrationScope;
  expiresAt: number;
}
export type SecretRequestStatus = "pending" | "saved" | "declined" | "closed";
