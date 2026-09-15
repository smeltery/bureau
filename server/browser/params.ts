export const BROWSER_ACTIONS = ["goto", "snapshot", "click", "fill", "press", "screenshot", "close"] as const;
export type BrowserAction = (typeof BROWSER_ACTIONS)[number];

export type BrowserErrorCode = "invalid_request" | "no_browser" | "launch_failed" | "no_page" | "action_failed" | "action_timeout";

export interface BrowserFailure {
  ok: false;
  status: 400 | 500;
  code: BrowserErrorCode;
  error: string;
}

export interface BrowserSuccess {
  ok: true;
  url: string;
  title: string;
  snapshot?: string;
  text?: string;
  png?: Buffer;
  filename?: string;
  caption?: string;
  closed?: boolean;
}

export type BrowserResult = BrowserSuccess | BrowserFailure;

const MAX_URL_LEN = 2048;
const MAX_SELECTOR_LEN = 500;
const MAX_FILL_LEN = 10_000;
const MIN_DIM = 320;
const MAX_DIM = 2560;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

export function fail(status: 400 | 500, code: BrowserErrorCode, error: string): BrowserFailure {
  return { ok: false, status, code, error };
}

function invalid(error: string): BrowserFailure {
  return fail(400, "invalid_request", error);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function describeShot(raw: string): { filename: string; caption: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { filename: "page.png", caption: "" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { filename: "page.png", caption: "" };
  const path = url.pathname === "/" ? "" : url.pathname;
  const slug = `${url.host}${path}`.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "page";
  return { filename: `${slug}.png`, caption: `${url.origin}${path}` };
}

export interface ParsedParams {
  ok: true;
  action: BrowserAction;
  url?: URL;
  selector?: string;
  text?: string;
  key?: string;
  fullPage?: boolean;
  viewport: { width: number; height: number };
}

export function parseBrowserParams(body: unknown): ParsedParams | BrowserFailure {
  if (!isPlainObject(body)) return invalid("body must be a JSON object");
  const action = body.action;
  if (typeof action !== "string" || !(BROWSER_ACTIONS as readonly string[]).includes(action)) {
    return invalid(`action must be one of: ${BROWSER_ACTIONS.join(", ")}`);
  }
  const params: ParsedParams = {
    ok: true,
    action: action as BrowserAction,
    viewport: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  };

  if (body.viewport !== undefined) {
    if (!isPlainObject(body.viewport)) return invalid("viewport must be an object {width, height}");
    const { width: w, height: h } = body.viewport;
    if (typeof w !== "number" || typeof h !== "number" || !Number.isInteger(w) || !Number.isInteger(h) || w < MIN_DIM || w > MAX_DIM || h < MIN_DIM || h > MAX_DIM) {
      return invalid(`viewport width/height must be integers in ${MIN_DIM}..${MAX_DIM}`);
    }
    params.viewport = { width: w, height: h };
  }

  if (action === "goto") {
    const raw = body.url;
    if (typeof raw !== "string" || raw.length === 0) return invalid("url is required for the goto action");
    if (raw.length > MAX_URL_LEN) return invalid(`url too long (max ${MAX_URL_LEN} chars)`);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return invalid(`not a valid URL: ${raw}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return invalid("only http:// and https:// URLs are supported");
    if (url.username || url.password) return invalid("URLs with embedded credentials are not allowed");
    params.url = url;
  }

  if (action === "click" || action === "fill") {
    const selector = body.selector;
    if (typeof selector !== "string" || selector.length === 0) return invalid(`selector is required for the ${action} action`);
    if (selector.length > MAX_SELECTOR_LEN) return invalid(`selector too long (max ${MAX_SELECTOR_LEN} chars)`);
    params.selector = selector;
  }

  if (action === "fill") {
    const text = body.text;
    if (typeof text !== "string") return invalid("text is required for the fill action");
    if (text.length > MAX_FILL_LEN) return invalid(`text too long (max ${MAX_FILL_LEN} chars)`);
    params.text = text;
  }

  if (action === "press") {
    const key = body.key;
    if (typeof key !== "string" || key.length === 0) return invalid("key is required for the press action");
    if (key.length > MAX_SELECTOR_LEN) return invalid(`key too long (max ${MAX_SELECTOR_LEN} chars)`);
    params.key = key;
    if (body.selector !== undefined) {
      if (typeof body.selector !== "string" || body.selector.length === 0) return invalid("selector must be a non-empty string");
      if (body.selector.length > MAX_SELECTOR_LEN) return invalid(`selector too long (max ${MAX_SELECTOR_LEN} chars)`);
      params.selector = body.selector;
    }
  }

  if (action === "screenshot" && body.fullPage !== undefined) {
    if (typeof body.fullPage !== "boolean") return invalid("fullPage must be a boolean");
    params.fullPage = body.fullPage;
  }

  return params;
}
