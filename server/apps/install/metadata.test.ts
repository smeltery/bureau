import { expect, test } from "bun:test";
import type { AppRecord } from "../../../shared/apps.ts";
import { createMetadataReader, parseAppMetadata } from "./metadata.ts";
import { appManifest, installPageMetadata } from "./manifest.ts";
const app = { name: "board", hostGen: 2, hostLabel: "board-g2", port: 21001 } as AppRecord;

test("metadata reads titles and embedded icons without trusting links or executable markup", async () => {
  const metadata = await parseAppMetadata(
    '<head><title>Team &amp; Board &#x1f680;</title><link rel="icon" href="javascript:alert(1)"><link rel="icon" href="http://internal/secret"><link rel="icon" href="data:image/svg+xml,%3Csvg%2F%3E"></head>',
    app.name,
  );
  expect(metadata).toEqual({ title: "Team & Board 🚀", icons: ["data:image/svg+xml,%3Csvg%2F%3E"] });
  const html = await installPageMetadata(
    '<head><title>Bureau</title><link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/office.png"><meta name="apple-mobile-web-app-title" content="Bureau"></head>',
    app,
    { ...metadata, title: '</title><script>alert("x")</script>' },
  );
  let scripts = 0;
  await new HTMLRewriter()
    .on("script", {
      element() {
        scripts++;
      },
    })
    .transform(new Response(html))
    .text();
  expect(scripts).toBe(0);
  expect(html).not.toContain("/office.png");
  expect(html).not.toContain('href="/manifest.json"');
  expect(html).toContain('crossorigin="use-credentials"');
  expect(html).toContain("/api/apps/board/manifest?generation=2");
  expect(html).toContain("&lt;script&gt;");
});
test("app identity, start URL and scope stay distinct from the office", () => {
  const manifest = appManifest(app, { title: "Team board", icons: [] }, false);
  expect(manifest).toMatchObject({ id: "/board/", start_url: "/board/", scope: "/board/", name: "Team board" });
  expect(manifest.icons[0]?.src).toStartWith("data:image/svg+xml,");
  expect(manifest.icons.some((icon) => icon.type === "image/png")).toBe(false);
  expect(appManifest(app, { title: "Board", icons: [] }, true).icons.some((icon) => icon.sizes === "512x512")).toBe(true);
});
test("metadata fetch stays on the registered local port, caches per generation and refuses redirects", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response("<head><title>Board title</title></head>", { headers: { "Content-Type": "text/html" } });
  }) as typeof fetch;
  const read = createMetadataReader({ running: () => true, fetch: fetcher, now: () => 1 });
  expect((await read(app)).title).toBe("Board title");
  await read(app);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("http://127.0.0.1:21001/");
  expect(calls[0]?.init?.redirect).toBe("error");
  expect(calls[0]?.init?.headers).toEqual({ Accept: "text/html" });
  await read({ ...app, hostGen: 3 });
  expect(calls).toHaveLength(2);
  await read({ ...app, port: 80 });
  expect(calls).toHaveLength(2);
  expect(await createMetadataReader({ running: () => false, fetch: fetcher, now: () => 1 })(app)).toEqual({ title: "board", icons: [] });
});
test("oversized, non-HTML and unreachable responses use safe metadata", async () => {
  for (const fetcher of [
    async () => new Response("x".repeat(262145), { headers: { "content-type": "text/html" } }),
    async () => new Response("<title>Wrong</title>"),
    async () => {
      throw new Error("unreachable");
    },
  ]) {
    const read = createMetadataReader({ running: () => true, fetch: fetcher, now: () => 1 });
    expect(await read(app)).toEqual({ title: "board", icons: [] });
  }
});

test("a stalled metadata request is aborted", async () => {
  let aborted = false;
  const read = createMetadataReader({
    running: () => true,
    now: Date.now,
    fetch: (_url: unknown, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      }),
  });
  expect(await read(app)).toEqual({ title: "board", icons: [] });
  expect(aborted).toBe(true);
});
