import { describe, expect, test } from "bun:test";
import { capturePreview, parsePreviewParams } from "./preview-capture.ts";

describe("preview capture", () => {
  test("requires an http URL", () => {
    const result = parsePreviewParams({ url: "ftp://127.0.0.1/app" });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: "only http:// and https:// URLs are supported",
    });
  });

  test("rejects out-of-range viewport dimensions", () => {
    const result = parsePreviewParams({ url: "http://127.0.0.1:3000", viewport: { width: 100, height: 800 } });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: "viewport width/height must be integers in 320..2560",
    });
  });

  test("rejects public IP addresses before browser capture", async () => {
    const result = await capturePreview(
      { url: "http://8.8.8.8" },
      {
        findBrowser: () => "/bin/false",
      },
    );

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: "only local or private network URLs are supported",
    });
  });

  test("accepts private DNS answers and then reports missing browser", async () => {
    const result = await capturePreview(
      { url: "http://devbox.local:3000" },
      {
        lookupFn: async () => [{ address: "192.168.1.20", family: 4 }],
        findBrowser: () => null,
      },
    );

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: "no Chrome-compatible browser found on PATH",
    });
  });
});
