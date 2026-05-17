import { loadOfficeConfig } from "./persistence/config/office-config.ts";

function parseOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getPublicOrigin(): string {
  const envOrigin = parseOrigin(process.env.BUREAU_PUBLIC_ORIGIN);
  if (envOrigin) return envOrigin;

  const configOrigin = parseOrigin(loadOfficeConfig().publicOrigin);
  if (configOrigin) return configOrigin;

  return `http://localhost:${process.env.PORT || "4000"}`;
}

export function originAllowed(req: Request, requestUrl: URL): boolean {
  const origin = req.headers.get("Origin");
  if (!origin) return true;

  const parsedOrigin = parseOrigin(origin);
  if (!parsedOrigin) return false;

  return parsedOrigin === requestUrl.origin || parsedOrigin === getPublicOrigin();
}

export function stateChangingOriginAllowed(req: Request, requestUrl: URL): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return true;
  }
  return originAllowed(req, requestUrl);
}
