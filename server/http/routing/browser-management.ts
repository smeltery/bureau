export function requiresBrowserSession(req: Request, url: URL): boolean {
  return (
    ((url.pathname.startsWith("/api/users/") ||
      url.pathname.startsWith("/api/tasks") ||
      url.pathname === "/api/audit-log" ||
      url.pathname.startsWith("/api/integrations/") ||
      url.pathname.startsWith("/api/me/provider-accounts") ||
      url.pathname === "/api/office/settings") &&
      !req.headers.has("authorization")) ||
    url.pathname.startsWith("/api/skills") ||
    url.pathname.startsWith("/api/webhooks") ||
    url.pathname.startsWith("/api/browser-sharing/") ||
    url.pathname.startsWith("/api/me/view/")
  );
}
