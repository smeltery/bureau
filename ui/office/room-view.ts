import type { Translator } from "../../shared/i18n/translate.ts";

export class RoomViewError extends Error {
  constructor(readonly status: number) {
    super(`Could not save room preferences (${status})`);
  }
}

export type RoomViewFailure = { status?: number };

export function roomViewFailure(error: unknown): RoomViewFailure {
  return error instanceof RoomViewError ? { status: error.status } : {};
}

export function roomViewFailureText(failure: RoomViewFailure, t: Translator["t"]): string {
  return failure.status === undefined ? t("roomsUi.saveFailed") : t("roomsUi.saveHttp", { status: failure.status });
}

export async function saveRoomView(kind: "order" | "shown", ids: string[]): Promise<void> {
  const response = await fetch(`/api/me/view/${kind}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [kind]: ids }),
  });
  if (!response.ok) throw new RoomViewError(response.status);
}
