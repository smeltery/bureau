import { BureauLogError } from "../../../../shared/i18n/backend-errors/error.ts";
import { logMessage } from "../../../../shared/i18n/log-message.ts";
import type { OpenCodeLease } from "../supervisor.ts";
import { fetchOpenCode } from "./deadlines.ts";

/** Capture the process endpoint before asynchronous cleanup can outlive its lease. */
export function openCodeRequest(lease: OpenCodeLease, cwd: string, timeoutMs: number) {
  const baseUrl = lease.baseUrl;
  const authorization = lease.authHeader;
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(path, baseUrl);
    url.searchParams.set("directory", cwd);
    const response = await fetchOpenCode(url, { ...init, headers: { authorization, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } }, timeoutMs);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new BureauLogError(logMessage("logs.backendError.http", { status: response.status, path }));
    }
    return response;
  };
}
