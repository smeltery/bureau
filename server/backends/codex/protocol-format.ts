export function mapTurnStatus(status: string | undefined): "completed" | "interrupted" | "failed" {
  switch (status) {
    case "completed":
      return "completed";
    case "interrupted":
      return "interrupted";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}

export function formatPatchChangeKind(kind: unknown): string {
  if (typeof kind === "string") return kind;
  if (!kind || typeof kind !== "object") return "modified";
  const type = (kind as { type?: unknown }).type;
  if (typeof type !== "string") return "modified";
  if (type !== "update") return type;
  const movePath = (kind as { move_path?: unknown }).move_path;
  return typeof movePath === "string" && movePath.length > 0 ? `update -> ${movePath}` : "update";
}

export function formatWebSearchAction(action: unknown): string {
  if (!action || typeof action !== "object") return "";
  const a = action as Record<string, unknown>;
  switch (a.type) {
    case "search": {
      const queries = Array.isArray(a.queries) ? a.queries.filter((q): q is string => typeof q === "string") : [];
      const query = queries.length ? queries.join(" | ") : typeof a.query === "string" ? a.query : "";
      return query ? `search: ${query}` : "search";
    }
    case "openPage": {
      const url = typeof a.url === "string" ? a.url : "";
      return url ? `openPage: ${url}` : "openPage";
    }
    case "findInPage": {
      const pattern = typeof a.pattern === "string" ? a.pattern : "";
      const url = typeof a.url === "string" ? a.url : "";
      if (pattern && url) return `findInPage: ${pattern} @ ${url}`;
      return pattern || url ? `findInPage: ${pattern || url}` : "findInPage";
    }
    case "other":
      return "other";
    default:
      return "";
  }
}
