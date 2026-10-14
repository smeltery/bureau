import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:https";
import { gzipSync } from "node:zlib";
import { createIntegrationStore } from "../store.ts";
import { createProxyMaterial } from "./material.ts";
import { startCredentialProxy } from "./server.ts";
import { injectCredentials, proxyCredentials } from "./credentials.ts";
import { SecretScrubber, secretPatterns } from "./scrub.ts";

test("credential forwarding verifies hosts and scrubs streamed compressed responses", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-credential-proxy-"));
  const store = createIntegrationStore(root);
  const scope = { kind: "office" as const };
  const secret = "ghp_privatecredential123456789012345678901";
  store.setSecret(scope, "GH_TOKEN", { value: secret, hosts: ["api.example.test"], form: { kind: "authorization" } });
  const material = await createProxyMaterial(root);
  const cert = await material.certificate("api.example.test");
  let received = "";
  let requestBody = "";
  const upstream = createServer(cert, (req, res) => {
    received = req.headers.authorization ?? "";
    req.on("data", (chunk) => {
      requestBody += chunk.toString();
    });
    req.on("end", () => {
      res.writeHead(200, { "content-encoding": "gzip", "x-reflected": received });
      res.end(gzipSync(JSON.stringify({ authorization: received, message: "ok" })));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  if (!upstreamAddress || typeof upstreamAddress === "string") throw new Error("Test server did not bind.");
  const proxy = await startCredentialProxy(store, material, { ca: material.ca, target: () => ({ host: "127.0.0.1", port: upstreamAddress.port }) });
  try {
    const credential = proxyCredentials(store, material.placeholderKey)[0]!;
    expect(credential.placeholder).toMatch(/^ghp_[a-f0-9]{36}$/);
    const process = Bun.spawn(
      [
        "curl",
        "--silent",
        "--show-error",
        "--max-time",
        "10",
        "--noproxy",
        "",
        "--proxy",
        `http://127.0.0.1:${proxy.port}`,
        "--cacert",
        material.trustPath,
        "--include",
        "--data-binary",
        "streamed request body",
        "-H",
        `Authorization: Bearer ${credential.placeholder}`,
        "https://api.example.test/echo",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [output, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(output).toContain("200 OK");
    expect(received).toBe(`Bearer ${secret}`);
    expect(requestBody).toBe("streamed request body");
    expect(output).toContain("ok");
    expect(output).toContain("[redacted]");
    expect(output).not.toContain(secret);
    expect(() => injectCredentials("other.example.test", { authorization: `Bearer ${credential.placeholder}` }, [credential])).toThrow("not permitted");
    expect(injectCredentials("api.example.test", { authorization: `Basic ${Buffer.from(`user:${credential.placeholder}`).toString("base64")}` }, [credential]).headers.authorization).toBe(
      `Basic ${Buffer.from(`user:${secret}`).toString("base64")}`,
    );
    await expect(material.certificate("api.openai.com")).rejects.toThrow();
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);

test("response scrubbing catches secrets split across every byte boundary", async () => {
  const value = "private-long-token";
  for (let split = 0; split <= value.length; split++) {
    const scrubber = new SecretScrubber(secretPatterns([value]));
    const chunks: Buffer[] = [];
    scrubber.on("data", (chunk) => chunks.push(chunk));
    const ended = new Promise<void>((resolve) => scrubber.on("end", resolve));
    scrubber.write(`before:${value.slice(0, split)}`);
    scrubber.end(`${value.slice(split)}:after`);
    await ended;
    expect(Buffer.concat(chunks).toString()).toBe("before:[redacted]:after");
  }
});
