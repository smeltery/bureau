import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthResult } from "../../../auth/auth-middleware.ts";
import { createMembersChatStore, type MembersChatStore } from "../../../members-chat/store.ts";
import { handleMembersChatRequest } from "../../members-chat.ts";

let dir: string, store: MembersChatStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bureau-chat-read-http-"));
  store = createMembersChatStore(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
function auth(userId: string): AuthResult {
  return { kind: "ok", session: { userId, username: userId, role: "member", sessionIdHash: "hash", sessionPrefix: "session", needsRolling: false, absoluteExpiresAt: Date.now() + 10000 } };
}
async function request(user: AuthResult | undefined, body: unknown, path = "/api/members-chat/read", method = "POST") {
  const req = new Request("http://office.test" + path, { method, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
  return handleMembersChatRequest(req, new URL(req.url), user, store);
}

async function upload(user: AuthResult | undefined, files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("file", file);
  const req = new Request("http://office.test/api/members-chat/uploads", { method: "POST", body: form });
  return handleMembersChatRequest(req, new URL(req.url), user, store);
}
async function download(filename: string, user = auth("bob")) {
  const req = new Request("http://office.test/api/members-chat/files/" + encodeURIComponent(filename));
  return handleMembersChatRequest(req, new URL(req.url), user, store);
}

test("browser uploads support attachment-only posts, authoritative metadata, empty captions and restart", async () => {
  const uploaded = await upload(auth("alice"), [new File(["<h1>Literal file</h1>"], "note.html", { type: "text/html" })]);
  expect(uploaded?.status).toBe(200);
  const file = (await uploaded!.json()).attachments[0];
  expect(file.filename).toMatch(/^[a-f0-9]{32}\.html$/);
  const posted = await request(auth("alice"), { text: "", attachments: [{ ...file, originalName: "Forged", mediaType: "image/png", size: 0 }] }, "/api/members-chat");
  expect(posted?.status).toBe(201);
  const message = await posted!.json();
  expect(message.attachments).toEqual([file]);
  const reply = store.post({ userId: "bob", userName: "Bob", content: "Reply", replyTo: message.id });
  expect(reply.replyTo?.excerpt).toBe("note.html");
  expect((await request(auth("alice"), { text: "" }, "/api/members-chat/" + message.id, "PUT"))?.status).toBe(200);
  store = createMembersChatStore(dir);
  expect(store.get(message.id)?.attachments).toEqual([file]);
  const served = await download(file.filename);
  expect(await served!.text()).toBe("<h1>Literal file</h1>");
  expect(served!.headers.get("content-type")).toBe("text/html");
  expect(served!.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
  expect(served!.headers.get("content-security-policy")).not.toContain("allow-same-origin");
  expect(served!.headers.get("x-content-type-options")).toBe("nosniff");
  expect(served!.headers.get("cache-control")).toBe("private, no-cache");
  const unknown = store.saveAttachment(Buffer.from("unknown"), "__proto__", "payload.constructor");
  expect((await download(unknown.filename))?.headers.get("content-type")).toBe("application/octet-stream");
  expect(store.saveAttachment(Buffer.from("fallback"), "constructor", "no-extension").filename).toEndWith(".bin");
  const unicode = store.saveAttachment(Buffer.from("name"), "text/plain", "a".repeat(2047) + "😀.txt");
  const unicodeDownload = await download(unicode.filename);
  expect(unicodeDownload?.status).toBe(200);
  expect(unicodeDownload?.headers.get("content-disposition")).toContain("%F0%9F%98%80");
});

test("file routes reject non-browser callers, unknown references and traversal", async () => {
  const file = store.saveAttachment(Buffer.from("private"), "text/plain", "notes.txt");
  for (const user of [undefined, { kind: "loopback" }, { kind: "api", token: { userId: "alice" } }] as Array<AuthResult | undefined>) {
    expect((await upload(user, [new File(["no"], "no.txt")]))?.status).toBe(401);
    const req = new Request("http://office.test/api/members-chat/files/" + file.filename);
    expect((await handleMembersChatRequest(req, new URL(req.url), user, store))?.status).toBe(401);
  }
  for (const filename of ["../reads.json", "..\\reads.json", file.filename + ".meta.json", "missing.txt", "a".repeat(32) + ".txt"]) {
    expect((await download(filename))?.status).toBe(404);
    expect((await request(auth("alice"), { text: "x", attachments: [{ filename }] }, "/api/members-chat"))?.status).toBe(400);
  }
  for (const attachments of [null, {}, [null], [file, file, file, file, file, file]]) expect((await request(auth("alice"), { text: "x", attachments }, "/api/members-chat"))?.status).toBe(400);
  const path = store.attachmentPath(file.filename)!;
  unlinkSync(path);
  const outside = join(dir, "outside.txt");
  writeFileSync(outside, "private");
  symlinkSync(outside, path);
  expect(store.attachmentPath(file.filename)).toBeNull();
  expect((await download(file.filename))?.status).toBe(404);
});

test("uploads validate the whole batch before saving files", async () => {
  expect((await upload(auth("alice"), []))?.status).toBe(400);
  expect(
    (
      await upload(
        auth("alice"),
        Array.from({ length: 6 }, () => new File(["a"], "a.txt")),
      )
    )?.status,
  ).toBe(400);
  expect(readdirSync(dir)).toEqual([]);
  const file = new File(["a"], "a.txt");
  Object.defineProperty(file, "size", { value: 201 * 1024 * 1024 });
  const req = new Request("http://office.test/api/members-chat/uploads", { method: "POST" });
  req.formData = async () => new Map([["file", file]]) as unknown as FormData;
  expect((await handleMembersChatRequest(req, new URL(req.url), auth("alice"), store))?.status).toBe(400);
  expect(readdirSync(dir)).toEqual([]);
  const largeFiles = Array.from({ length: 3 }, (_, index) => {
    const part = new File(["a"], `part-${index}.txt`);
    Object.defineProperty(part, "size", { value: 150 * 1024 * 1024 });
    return [String(index), part] as const;
  });
  req.formData = async () => new Map(largeFiles) as unknown as FormData;
  expect((await handleMembersChatRequest(req, new URL(req.url), auth("alice"), store))?.status).toBe(400);
  expect(readdirSync(dir)).toEqual([]);
});

test("generated filenames preserve same-named uploads and never use caller paths", () => {
  const first = store.saveAttachment(Buffer.from("first"), "text/plain", "../../same.txt");
  const second = store.saveAttachment(Buffer.from("second"), "text/plain", "../../same.txt");
  expect(first.filename).not.toBe(second.filename);
  expect(store.getAttachment(first.filename)).toEqual(first);
  expect(store.getAttachment(second.filename)).toEqual(second);
  expect(store.attachmentPath(first.filename)).toBe(join(dir, "files", first.filename));
  writeFileSync(join(dir, "files", first.filename + ".meta.json"), "invalid");
  expect(store.getAttachment(first.filename)).toBeNull();
});
