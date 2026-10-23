import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { assetPath, acceptedEncodings, serveAsset } from "./serve.ts";
import { compressUi } from "../../../scripts/ui-build/compress.ts";

test("static representations negotiate compression, validate caches and retain content types", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-static-"));
  try {
    const path = join(root, `index-${"a".repeat(24)}.js`);
    const content = 'console.log("ready");'.repeat(100);
    writeFileSync(path, content);
    writeFileSync(join(root, "index.html"), "<html>private shell</html>");
    compressUi(root);
    const request = (headers: Record<string, string> = {}, method = "GET") => new Request("http://office.test/index.js", { headers, method });
    const br = (await serveAsset(request({ "accept-encoding": "gzip;q=0.5, br" }), path))!;
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("content-type")).toContain("javascript");
    expect(br.headers.get("cache-control")).toContain("private");
    expect(br.headers.get("cache-control")).toContain("immutable");
    const etag = br.headers.get("etag")!;
    expect(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString()).toBe(content);
    const cached = (await serveAsset(request({ "accept-encoding": "br", "if-none-match": etag }), path))!;
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
    const gz = (await serveAsset(request({ "accept-encoding": "br;q=0, gzip" }), path))!;
    expect(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()).toBe(content);
    const plain = (await serveAsset(request(), path))!;
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.text()).toBe(content);
    const head = (await serveAsset(request({ "accept-encoding": "br" }, "HEAD"), path))!;
    expect(await head.text()).toBe("");
    expect(Number(head.headers.get("content-length"))).toBeGreaterThan(0);
    expect((await serveAsset(request(), join(root, "index.html")))!.headers.get("cache-control")).toBe("private, no-cache");
    expect(await serveAsset(request(), join(root, "missing.js"))).toBeNull();
    expect((await serveAsset(request({}, "POST"), path))!.status).toBe(405);
    expect(acceptedEncodings("br;q=0, *;q=0.5")).toEqual(["gzip"]);
    expect(assetPath(root, "/%2e%2e/private")).toBeNull();
    expect(assetPath(root, "/%00")).toBeNull();
    expect(assetPath(root, "/bad%zz")).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
