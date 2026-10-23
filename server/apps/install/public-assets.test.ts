import { expect, test } from "bun:test";
import { handlePublicInstallAsset } from "../../http/static.ts";

test("only bundled install assets are public, never app metadata or arbitrary files", async () => {
  for (const path of ["/api/apps/private/manifest", "/private/", "/index.html", "/index.js", "/icons/unknown.png", "/icons/../index.html"]) {
    const req = new Request("https://office.example" + path);
    expect(await handlePublicInstallAsset(req, new URL(req.url))).toBeNull();
  }
  const req = new Request("https://office.example/icons/icon-192.png");
  const response = await handlePublicInstallAsset(req, new URL(req.url));
  expect(response).not.toBeNull();
  // A source-only checkout may not yet have built assets; never return a login or SPA shell.
  expect([200, 404]).toContain(response!.status);
  if (response!.status === 200) expect(response!.headers.get("content-type")).toContain("image/png");
  const post = new Request(req.url, { method: "POST" });
  expect(await handlePublicInstallAsset(post, new URL(post.url))).toBeNull();
});
