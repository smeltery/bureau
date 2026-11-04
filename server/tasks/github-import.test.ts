import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGithubImport } from "./github-import.ts";

test("the import form accepts owner/name or the repo's URL, and one label", () => {
  expect(parseGithubImport({ repo: " https://github.com/acme/web/ ", label: " bug " })).toEqual({ repo: "acme/web", label: "bug" });
  expect(parseGithubImport({ repo: "acme/web" })).toEqual({ repo: "acme/web" });
  expect(() => parseGithubImport({ repo: "acme" })).toThrow("owner/name");
  expect(() => parseGithubImport({ repo: "acme/web/issues" })).toThrow("owner/name");
  expect(() => parseGithubImport({ repo: "acme/web", label: "bug,ui" })).toThrow("one label");
});

// Runs in its own process: the import writes to the shared board and its
// task records, so the office home must be a scratch folder.
test("importing creates tasks for open issues and follows closes and reopens", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-github-import-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { importGithubIssues, GithubImportError } from "./server/tasks/github-import.ts";
      import { tasks } from "./server/ws/broadcast.ts";
      import { taskStore } from "./server/tasks/store.ts";
      const issue = (number, state, extra = {}) => ({ number, state, title: "Issue " + number, body: "Body " + number, html_url: "https://github.com/acme/web/issues/" + number, ...extra });
      let pages = [];
      const urls = [];
      const fakeFetch = async (url) => { urls.push(String(url)); return Response.json(pages.shift() ?? []); };
      const input = { repo: "acme/web", label: "bug", roomId: undefined, actor: "Ana" };

      pages = [[issue(1, "open"), issue(2, "closed"), issue(3, "open", { pull_request: {} })]];
      expect(await importGithubIssues(input, fakeFetch)).toEqual({ created: 1, closed: 0, reopened: 0 });
      expect(urls[0]).toContain("/repos/acme/web/issues?state=all");
      expect(urls[0]).toContain("labels=bug");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ title: "Issue 1", status: "open", createdBy: "Ana", github: { repo: "acme/web", number: 1, url: "https://github.com/acme/web/issues/1" } });
      expect(tasks[0].description).toBe("https://github.com/acme/web/issues/1\\n\\nBody 1");
      expect(taskStore.load()).toEqual(tasks);

      pages = [[issue(1, "open")]];
      expect(await importGithubIssues(input, fakeFetch)).toEqual({ created: 0, closed: 0, reopened: 0 });
      expect(tasks).toHaveLength(1);

      pages = [[issue(1, "closed")]];
      expect(await importGithubIssues(input, fakeFetch)).toEqual({ created: 0, closed: 1, reopened: 0 });
      expect(tasks[0].status).toBe("done");
      pages = [[issue(1, "open")]];
      expect(await importGithubIssues(input, fakeFetch)).toEqual({ created: 0, closed: 0, reopened: 1 });
      expect(tasks[0].status).toBe("open");

      // A full page asks for the next one, up to three pages.
      pages = [Array.from({ length: 100 }, (_, i) => issue(100 + i, "closed")), Array.from({ length: 100 }, (_, i) => issue(200 + i, "closed")), Array.from({ length: 100 }, (_, i) => issue(300 + i, "closed")), [issue(999, "open")]];
      urls.length = 0;
      await importGithubIssues(input, fakeFetch);
      expect(urls).toHaveLength(3);

      const failing = (status) => async () => new Response("{}", { status });
      await expect(importGithubIssues(input, failing(404))).rejects.toMatchObject({ status: 404, message: "acme/web was not found, or it is private" });
      await expect(importGithubIssues(input, failing(403))).rejects.toBeInstanceOf(GithubImportError);
      expect(tasks).toHaveLength(1);

      const { handleTasksRequest } = await import("./server/http/tasks.ts");
      const route = (auth, body) => {
        const req = new Request("http://localhost/api/tasks/import/github", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        return handleTasksRequest(req, new URL(req.url), auth);
      };
      const member = { kind: "ok", session: { userId: "u1", username: "ana", role: "member" } };
      expect((await route({ kind: "api", token: { username: "bot", tokenId: "t1", role: "owner" } }, { repo: "acme/web" })).status).toBe(401);
      expect((await route(member, { repo: "nope" })).status).toBe(400);
      expect((await route(member, { repo: "acme/web", roomId: "missing-room" })).status).toBe(404);
      process.exit(0);
    `,
      ],
      { env: { ...process.env, BUREAU_HOME: root }, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
