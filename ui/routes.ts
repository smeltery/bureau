// Full-page panel URLs for the office UI. Pure and DOM-free so the table can
// be unit-tested without rendering App. Agent chats stay on "/" — only the
// panel pages (plus plugins) get their own path.

export type Page = "tasks" | "schedules" | "apps" | "skills" | "plugins" | "settings" | "team-chat";

/**
 * The page a pathname names, or null for the office.
 *
 * Trailing slashes are forgiven. Matching is case-sensitive. `/cronjobs` is
 * accepted as an alias for schedules (pre-rename links) but never produced.
 */
export function pageForPath(pathname: string): Page | null {
  switch (pathname.replace(/\/+$/, "") || "/") {
    case "/tasks":
      return "tasks";
    case "/schedules":
    case "/cronjobs":
      return "schedules";
    case "/apps":
      return "apps";
    case "/skills":
      return "skills";
    case "/plugins":
      return "plugins";
    case "/settings":
    case "/users":
    case "/pager":
      return "settings";
    case "/team-chat":
    case "/chat":
      return "team-chat";
    default:
      return null;
  }
}

/** Canonical path for a page, or "/" for the office. */
export function pathForPage(page: Page | null): string {
  return page === null ? "/" : `/${page}`;
}
