const LOCAL_BUREAU_URL_RE = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::\d+)?\/[^\s'"\\)]+/g;

const BODY_FLAG_RE = /(?:^|\s)(?:--data(?:-raw|-binary)?|-d)\s+(["'])([\s\S]*?)\1/;
const STDIN_BODY_FLAG_RE = /(?:^|\s)(?:--data(?:-raw|-binary)?|-d)\s+@-/;
const DIRECT_HEREDOC_RE = /<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1\s*\n([\s\S]*?)\n\2\s*$/;

type JsonObject = Record<string, unknown>;

const routeLabels: Array<[RegExp, string]> = [
  [/^\/api\/agents\/[^/]+\/read-file$/, "Bureau API: show file to boss"],
  [/^\/api\/agents\/[^/]+\/preview-url$/, "Bureau API: browser preview"],
  [/^\/api\/agents\/[^/]+\/terminal-command$/, "Bureau API: terminal card"],
  [/^\/api\/agents\/[^/]+\/diff$/, "Bureau API: diff card"],
  [/^\/api\/agents\/[^/]+\/edit-file$/, "Bureau API: open file in editor"],
  [/^\/api\/agents\/[^/]+\/messages?$/, "Bureau API: message agent"],
  [/^\/api\/agents\/[^/]+\/context$/, "Bureau API: check context"],
  [/^\/api\/agents\/[^/]+\/instructions$/, "Bureau API: read agent instructions"],
  [/^\/api\/agents\/[^/]+\/scheduled-messages$/, "Bureau API: scheduled messages"],
  [/^\/api\/agents\/[^/]+\/scheduled-messages\/[^/]+$/, "Bureau API: cancel scheduled message"],
  [/^\/api\/agents\/[^/]+\/queue\/[^/]+$/, "Bureau API: cancel queued message"],
  [/^\/api\/agents\/[^/]+\/abort$/, "Bureau API: interrupt agent"],
  [/^\/api\/agents\/[^/]+\/send-now$/, "Bureau API: send queued messages now"],
  [/^\/api\/tasks(?:\/.*)?$/, "Bureau API: tasks"],
  [/^\/api\/version$/, "Bureau API: version"],
  [/^\/api\/memory(?:\/.*)?$/, "Bureau API: memory"],
  [/^\/api\/skill-usage$/, "Bureau API: skill-use counts"],
  [/^\/api\/cronjobs(?:\/.*)?$/, "Bureau API: cron jobs"],
  [/^\/api\/cron-runs$/, "Bureau API: recent cron runs"],
  [/^\/api\/rooms\/[^/]+\/settings$/, "Bureau API: room settings"],
];

const fieldOrder = ["path", "url", "command", "text", "title", "status", "assignee", "room"];

export function summarizeBureauCurl(command: string): string | null {
  if (!/\bcurl\b/.test(command)) return null;
  const url = extractLocalBureauUrl(command);
  if (!url) return null;

  const label = routeLabels.find(([pattern]) => pattern.test(url.pathname))?.[1];
  if (!label) return null;

  const fields = extractBodyFields(command);
  const summary = fields.length > 0 ? `${label} - ${fields.join(", ")}` : label;
  return truncate(summary, 80);
}

function extractLocalBureauUrl(command: string): URL | null {
  const matches = command.matchAll(LOCAL_BUREAU_URL_RE);
  for (const match of matches) {
    const raw = match[0];
    const normalized = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `http://${raw}`;
    try {
      const url = new URL(normalized);
      if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.pathname.startsWith("/api/")) {
        return url;
      }
    } catch {
      // Keep scanning; a later token may still be a parseable local URL.
    }
  }
  return null;
}

function extractBodyFields(command: string): string[] {
  const body = BODY_FLAG_RE.exec(command)?.[2] ?? extractDirectHeredocBody(command);
  if (!body) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!isJsonObject(parsed)) return [];

  return fieldOrder
    .filter((key) => Object.prototype.hasOwnProperty.call(parsed, key))
    .map((key) => formatField(key, parsed[key]))
    .filter((field): field is string => field !== null)
    .slice(0, 3);
}

function extractDirectHeredocBody(command: string): string | null {
  if (!STDIN_BODY_FLAG_RE.test(command)) return null;
  const match = DIRECT_HEREDOC_RE.exec(command);
  return match ? match[3] : null;
}

function formatField(key: string, value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return `${key}=${truncate(value, 36)}`;
  if (typeof value === "number" || typeof value === "boolean") return `${key}=${String(value)}`;
  return null;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}
