import { spawn, spawnSync } from "child_process";
import { lookup } from "dns/promises";
import { mkdtemp, readFile, rm } from "fs/promises";
import { isIP } from "net";
import { tmpdir } from "os";
import { join } from "path";

export type PreviewErrorCode = "invalid_request" | "capture_busy" | "no_browser" | "unreachable" | "capture_failed" | "capture_timeout";

export type PreviewSuccess = { ok: true; png: Buffer; caption: string; filename: string };
export type PreviewFailure = { ok: false; status: 400 | 429 | 500; code: PreviewErrorCode; error: string };
export type PreviewResult = PreviewSuccess | PreviewFailure;

export interface PreviewCaptureDeps {
  findBrowser?: () => string | null;
  fetchFn?: typeof fetch;
  lookupFn?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  publicHostAllowlist?: string[];
  deadlineMs?: number;
  tmpBase?: string;
}

type ParsedPreviewParams = { ok: true; url: URL; width: number; height: number; wait: number };

const MAX_URL_LEN = 2048;
const MIN_DIM = 320;
const MAX_DIM = 2560;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MAX_WAIT_MS = 10_000;
const DEFAULT_DEADLINE_MS = 20_000;
const PREFLIGHT_TIMEOUT_MS = 2_000;
const KILL_GRACE_MS = 2_000;
const MAX_PNG_BYTES = 20 * 1024 * 1024;
const STDERR_TAIL_CHARS = 500;
const MAX_CONCURRENT_CAPTURES = 2;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const BROWSER_CANDIDATES = ["google-chrome", "chromium", "chromium-browser"];

let activeCaptures = 0;

function fail(status: 400 | 429 | 500, code: PreviewErrorCode, error: string): PreviewFailure {
  return { ok: false, status, code, error };
}

function invalid(error: string): PreviewFailure {
  return fail(400, "invalid_request", error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePreviewParams(body: unknown): PreviewFailure | ParsedPreviewParams {
  if (!isRecord(body)) return invalid("body must be a JSON object");
  const rawUrl = body.url;
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return invalid("url is required");
  if (rawUrl.length > MAX_URL_LEN) return invalid(`url too long (max ${MAX_URL_LEN} chars)`);

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return invalid(`not a valid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return invalid("only http:// and https:// URLs are supported");
  if (url.username || url.password) return invalid("URLs with embedded credentials are not allowed");
  url.hash = "";

  let width = DEFAULT_WIDTH;
  let height = DEFAULT_HEIGHT;
  if (body.viewport !== undefined) {
    if (!isRecord(body.viewport)) return invalid("viewport must be an object {width, height}");
    const w = body.viewport.width;
    const h = body.viewport.height;
    if (typeof w !== "number" || typeof h !== "number" || !Number.isInteger(w) || !Number.isInteger(h) || w < MIN_DIM || w > MAX_DIM || h < MIN_DIM || h > MAX_DIM) {
      return invalid(`viewport width/height must be integers in ${MIN_DIM}..${MAX_DIM}`);
    }
    width = w;
    height = h;
  }

  let wait = 0;
  if (body.wait !== undefined) {
    if (typeof body.wait !== "number" || !Number.isInteger(body.wait) || body.wait < 0 || body.wait > MAX_WAIT_MS) {
      return invalid(`wait must be an integer in 0..${MAX_WAIT_MS} (ms)`);
    }
    wait = body.wait;
  }

  return { ok: true, url, width, height, wait };
}

function ipv4Allowed(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}

function parseIpv6Groups(ip: string): number[] | null {
  const dc = ip.indexOf("::");
  let head = ip;
  let tail = "";
  if (dc !== -1) {
    head = ip.slice(0, dc);
    tail = ip.slice(dc + 2);
    if (tail.includes("::")) return null;
  }
  const parseSide = (s: string): number[] | null => {
    if (s === "") return [];
    const groups: number[] = [];
    for (const part of s.split(":")) {
      if (part.includes(".")) {
        const v4 = part.split(".").map(Number);
        if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        groups.push((v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!);
      } else {
        if (!/^[0-9a-f]{1,4}$/u.test(part)) return null;
        groups.push(Number.parseInt(part, 16));
      }
    }
    return groups;
  };
  const h = parseSide(head.toLowerCase());
  const t = parseSide(tail.toLowerCase());
  if (!h || !t) return null;
  if (dc === -1) return h.length === 8 ? h : null;
  const fill = 8 - h.length - t.length;
  return fill >= 1 ? [...h, ...Array<number>(fill).fill(0), ...t] : null;
}

function ipv6Allowed(ip: string): boolean {
  const g = parseIpv6Groups(ip);
  if (!g) return false;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return ipv4Allowed(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`);
  return ip.toLowerCase() === "::1" || (g[0]! & 0xfe00) === 0xfc00 || (g[0]! & 0xffc0) === 0xfe80;
}

function addressAllowed(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return ipv4Allowed(address);
  if (family === 6) return ipv6Allowed(address);
  return false;
}

async function assertAllowedHost(url: URL, deps: Pick<PreviewCaptureDeps, "lookupFn" | "publicHostAllowlist">): Promise<PreviewResult | null> {
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (deps.publicHostAllowlist?.map((host) => host.toLowerCase()).includes(hostname)) return null;
  if (addressAllowed(url.hostname)) return null;
  if (hostname === "localhost") return null;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await (deps.lookupFn ?? ((host) => lookup(host, { all: true })))(url.hostname);
  } catch {
    return fail(400, "invalid_request", "host could not be resolved");
  }
  if (addresses.length === 0 || addresses.some((a) => !addressAllowed(a.address))) {
    return fail(400, "invalid_request", "only local/private network URLs or preview-allowlisted hosts are supported");
  }
  return null;
}

export function findBrowser(): string | null {
  const override = process.env.BUREAU_PREVIEW_BROWSER;
  if (override) return override;
  for (const candidate of BROWSER_CANDIDATES) {
    const found = spawnSync("which", [candidate], { encoding: "utf8" }).stdout.trim();
    if (found) return found;
  }
  return null;
}

function safeFilename(url: URL): string {
  const raw = `${url.hostname}-${url.port || (url.protocol === "https:" ? "443" : "80")}${url.pathname.replace(/\/$/u, "")}`;
  const safe =
    raw
      .replace(/[^a-z0-9._-]+/giu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80) || "page";
  return `preview-${safe}.png`;
}

function caption(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

async function preflight(url: URL, fetchFn: typeof fetch): Promise<PreviewResult | null> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), PREFLIGHT_TIMEOUT_MS);
  try {
    await fetchFn(url, { method: "GET", signal: ac.signal });
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(500, "unreachable", `URL is not reachable before capture: ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function runBrowser(browser: string, url: URL, width: number, height: number, wait: number, outputPath: string, deadlineMs: number): Promise<PreviewResult | null> {
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${wait}`,
    `--screenshot=${outputPath}`,
    url.toString(),
  ];
  const child = spawn(browser, args, { detached: true, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-STDERR_TAIL_CHARS);
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {}
    setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
    }, KILL_GRACE_MS).unref();
  }, deadlineMs);

  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  clearTimeout(timer);
  if (timedOut) return fail(500, "capture_timeout", "browser preview capture timed out");
  if (code !== 0) return fail(500, "capture_failed", `browser preview failed${stderr ? `: ${stderr}` : ""}`);
  return null;
}

function hasPngSignature(data: Buffer): boolean {
  return data.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => data[i] === b);
}

export async function capturePreview(body: unknown, deps: PreviewCaptureDeps = {}): Promise<PreviewResult> {
  const parsed = parsePreviewParams(body);
  if (!parsed.ok) return parsed;
  if (activeCaptures >= MAX_CONCURRENT_CAPTURES) return fail(429, "capture_busy", "too many preview captures are already running");

  const policyError = await assertAllowedHost(parsed.url, deps);
  if (policyError) return policyError;

  const browser = (deps.findBrowser ?? findBrowser)();
  if (!browser) return fail(500, "no_browser", "no Chrome-compatible browser found on PATH");

  const preflightError = await preflight(parsed.url, deps.fetchFn ?? fetch);
  if (preflightError) return preflightError;

  activeCaptures++;
  const dir = await mkdtemp(join(deps.tmpBase ?? tmpdir(), "bureau-preview-"));
  const outputPath = join(dir, "capture.png");
  try {
    const browserError = await runBrowser(browser, parsed.url, parsed.width, parsed.height, parsed.wait, outputPath, deps.deadlineMs ?? DEFAULT_DEADLINE_MS);
    if (browserError) return browserError;
    const png = await readFile(outputPath);
    if (png.length === 0 || png.length > MAX_PNG_BYTES || !hasPngSignature(png)) return fail(500, "capture_failed", "browser did not produce a valid PNG");
    return { ok: true, png, caption: caption(parsed.url), filename: safeFilename(parsed.url) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(500, "capture_failed", msg);
  } finally {
    activeCaptures--;
    await rm(dir, { recursive: true, force: true });
  }
}
