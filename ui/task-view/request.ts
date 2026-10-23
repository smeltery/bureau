import { translatorFor, type PlainMessageKey } from "../../shared/i18n/translate.ts";

export type TaskFailure = string | { key: PlainMessageKey };

class TaskRequestError extends Error {
  constructor(readonly failure: TaskFailure) {
    super(typeof failure === "string" ? failure : translatorFor("en").t(failure.key));
  }
}

export async function taskResponse(path: string, fallback: PlainMessageKey, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new TaskRequestError(typeof data?.error === "string" && data.error ? data.error : { key: fallback });
  }
  return response;
}

export function taskFailure(error: unknown, fallback: PlainMessageKey): TaskFailure {
  if (error instanceof TaskRequestError) return error.failure;
  return error instanceof Error ? error.message : { key: fallback };
}
