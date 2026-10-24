export const MESSAGE_QUERY_FIELDS = { steer: "boolean", sendNow: "boolean", clientMessageId: "string", deliverAt: "string" } as const;
type QueryFields = Readonly<Record<string, "boolean" | "string">>;
type MessageBodyResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string };

function jsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Decode message transport before applying the route's existing sender rules. */
export function parseMessageBody(raw: string, contentType: string | null, search: string, fields: QueryFields = MESSAGE_QUERY_FIELDS): MessageBodyResult {
  const plain = contentType?.split(";", 1)[0]?.trim().toLowerCase() === "text/plain";
  const json = jsonObject(raw);
  const options: Record<string, unknown> = {};
  const pairs = search.replace(/^\?/, "").split("&").filter(Boolean);
  const invalid = (error: string): MessageBodyResult => ({ ok: false, status: 422, error });
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    let key: string, value: string;
    try {
      key = decodeURIComponent(separator < 0 ? pair : pair.slice(0, separator));
      // Unlike form decoding, this preserves the + in an RFC3339 offset.
      value = decodeURIComponent(separator < 0 ? "" : pair.slice(separator + 1));
    } catch {
      return invalid("Malformed query parameter encoding");
    }
    if (!Object.hasOwn(fields, key)) {
      if (plain) return invalid(`Unknown message option: ${key}`);
      continue;
    }
    if (!plain) return invalid(`Query option ${key} requires Content-Type: text/plain`);
    if (Object.hasOwn(options, key)) return invalid(`Repeated message option: ${key}`);
    if (separator < 0) return invalid(`Message option ${key} requires a value`);
    if (fields[key] === "boolean") {
      if (value !== "1" && value !== "true" && value !== "0" && value !== "false") return invalid(`Message option ${key} must be true, false, 1, or 0`);
      options[key] = value === "1" || value === "true";
    } else {
      options[key] = value;
    }
  }
  // fetch(string) defaults to text/plain. Preserve existing JSON callers using it.
  if (!plain || (pairs.length === 0 && typeof json?.text === "string")) {
    return json ? { ok: true, body: json } : { ok: false, status: 400, error: "invalid JSON body" };
  }
  const body: Record<string, unknown> = { text: raw };
  for (const key of Object.keys(fields)) if (Object.hasOwn(options, key)) body[key] = options[key];
  return { ok: true, body };
}
