import type { AppRecord } from "../../shared/apps.ts";
import { RESERVED_APP_NAMES } from "./registry.ts";

export function appShortUrl(app: AppRecord, publicUrl: string | null, officeOrigin: string): string | undefined {
  if (!publicUrl || app.archivedAt !== undefined || RESERVED_APP_NAMES.has(app.name)) return undefined;
  return new URL(`/${app.name}`, officeOrigin).href;
}
