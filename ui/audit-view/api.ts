import type { PlainMessageKey, Translator } from "../../shared/i18n/translate.ts";
export type AuditFailure = string | { key: PlainMessageKey };
class AuditResponseError extends Error {}
export async function auditRequest(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) {
    if (typeof body?.error === "string" && body.error) throw new AuditResponseError(body.error);
    throw new Error("Audit request failed");
  }
  return body;
}
export function auditFailure(error: unknown, key: PlainMessageKey): AuditFailure {
  return error instanceof AuditResponseError ? error.message : { key };
}
export function auditFailureText(error: AuditFailure, t: Translator["t"]): string {
  return typeof error === "string" ? error : t(error.key);
}
