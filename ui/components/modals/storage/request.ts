import { translatorFor, type PlainMessageKey } from "../../../../shared/i18n/translate.ts";

export type StorageFailure = string | { key: PlainMessageKey };

class StorageRequestError extends Error {
  constructor(readonly failure: StorageFailure) {
    super(typeof failure === "string" ? failure : translatorFor("en").t(failure.key));
  }
}

export async function storageRequest<T>(path: string, fallback: PlainMessageKey, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new StorageRequestError(typeof body?.error === "string" && body.error ? body.error : { key: fallback });
  }
  return response.json();
}

export function storageFailure(error: unknown, fallback: PlainMessageKey): StorageFailure {
  if (error instanceof StorageRequestError) return error.failure;
  return error instanceof Error ? error.message : { key: fallback };
}
