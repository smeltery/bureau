import { relative, resolve, sep } from "node:path";

export function assetPath(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const path = resolve(root, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  const remainder = relative(root, path);
  return remainder === ".." || remainder.startsWith(`..${sep}`) || !remainder ? null : path;
}
export function acceptedEncodings(header: string): string[] {
  const weights = new Map<string, number>();
  for (const part of header.toLowerCase().split(",")) {
    const [name, ...params] = part.trim().split(";");
    const quality = params
      .find((p) => p.trim().startsWith("q="))
      ?.trim()
      .slice(2);
    const weight = quality === undefined ? 1 : Number(quality);
    weights.set(name, Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0);
  }
  return ["br", "gzip"]
    .map((name) => ({ name, weight: weights.get(name) ?? weights.get("*") ?? 0 }))
    .filter((item) => item.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((item) => item.name);
}
export async function serveAsset(req: Request, path: string): Promise<Response | null> {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const original = Bun.file(path);
  if (!(await original.exists())) return null;
  let file = original;
  let encoding: string | null = null;
  // Sidecars are representations of public build files, never route responses.
  for (const candidate of acceptedEncodings(req.headers.get("accept-encoding") ?? "")) {
    const compressed = Bun.file(`${path}.${candidate === "br" ? "br" : "gz"}`);
    if (await compressed.exists()) {
      file = compressed;
      encoding = candidate;
      break;
    }
  }
  const immutable = /(?:index-[a-f0-9]{24}|entry-[a-z0-9]+|chunk-[a-z0-9]+)\.js$/i.test(path);
  const etag = `W/"${file.lastModified.toString(16)}-${file.size.toString(16)}-${encoding ?? "identity"}"`;
  const headers = new Headers({
    "Content-Type": original.type,
    "Cache-Control": immutable ? "private, max-age=31536000, immutable" : "private, no-cache",
    Vary: "Accept-Encoding",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  });
  if (encoding) headers.set("Content-Encoding", encoding);
  if ((req.headers.get("if-none-match") ?? "").split(",").some((tag) => tag.trim() === etag || tag.trim() === "*")) return new Response(null, { status: 304, headers });
  headers.set("Content-Length", String(file.size));
  return new Response(req.method === "HEAD" ? null : file, { headers });
}
