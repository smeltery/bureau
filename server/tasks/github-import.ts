// Import a public GitHub repository's issues into the task board. A member
// runs it by hand: new open issues become tasks, and tasks already imported
// follow their issue closing or reopening. Nothing is written to GitHub.
import { generateTaskId, type ServerMessage, type TaskItem } from "../../shared/types.ts";
import { broadcast, tasks } from "../ws/broadcast.ts";
import { taskStore } from "./store.ts";

export interface GithubImportInput {
  repo: string;
  label?: string;
  roomId?: string;
  actor: string;
}

export interface GithubImportResult {
  created: number;
  closed: number;
  reopened: number;
}

export class GithubImportError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  pull_request?: unknown;
}

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const MAX_LABEL_LENGTH = 50;
const PER_PAGE = 100;
// The most recently updated 300 issues: enough for a board, and 3 of the 60
// requests an hour GitHub allows without a token.
const MAX_PAGES = 3;
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 4000;
const FETCH_TIMEOUT_MS = 15_000;

export function parseGithubImport(body: Record<string, unknown>): { repo: string; label?: string } {
  const repo =
    typeof body.repo === "string"
      ? body.repo
          .trim()
          .replace(/^https:\/\/github\.com\//i, "")
          .replace(/\/+$/, "")
      : "";
  if (!REPO.test(repo)) throw new GithubImportError("repo must look like owner/name", 400);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (label.length > MAX_LABEL_LENGTH || label.includes(",")) throw new GithubImportError(`label must be one label of at most ${MAX_LABEL_LENGTH} characters`, 400);
  return label ? { repo, label } : { repo };
}

export async function importGithubIssues(input: GithubImportInput, fetchImpl: typeof fetch = fetch): Promise<GithubImportResult> {
  const issues = await fetchIssues(input.repo, input.label, fetchImpl);
  const result: GithubImportResult = { created: 0, closed: 0, reopened: 0 };
  const repoKey = input.repo.toLowerCase();
  // One task per issue on the whole board, so a task moved to another room is
  // still followed rather than imported twice.
  const imported = new Map(tasks.filter((t) => t.github?.repo.toLowerCase() === repoKey).map((t) => [t.github!.number, t]));
  for (const issue of issues) {
    const task = imported.get(issue.number);
    if (!task) {
      if (issue.state !== "open") continue;
      addTask(issue, input);
      result.created++;
    } else if (issue.state === "closed" && task.status !== "done" && task.status !== "obsolete") {
      updateTask(task, "done", input.actor);
      result.closed++;
    } else if (issue.state === "open" && task.status === "done") {
      updateTask(task, "open", input.actor);
      result.reopened++;
    }
  }
  if (result.created || result.closed || result.reopened) broadcast({ type: "tasks", tasks } as ServerMessage);
  return result;
}

async function fetchIssues(repo: string, label: string | undefined, fetchImpl: typeof fetch): Promise<GithubIssue[]> {
  const issues: GithubIssue[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(`https://api.github.com/repos/${repo}/issues`);
    url.search = new URLSearchParams({ state: "all", sort: "updated", direction: "desc", per_page: String(PER_PAGE), page: String(page), ...(label ? { labels: label } : {}) }).toString();
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "bureau-task-import" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch {
      throw new GithubImportError("GitHub could not be reached", 502);
    }
    if (response.status === 404) throw new GithubImportError(`${repo} was not found, or it is private`, 404);
    if (response.status === 403 || response.status === 429) throw new GithubImportError("GitHub's rate limit was reached; try again later", 429);
    if (!response.ok) throw new GithubImportError(`GitHub answered ${response.status}`, 502);
    const batch = (await response.json()) as unknown;
    if (!Array.isArray(batch)) throw new GithubImportError("GitHub sent an unexpected answer", 502);
    issues.push(...batch.filter(isIssue));
    if (batch.length < PER_PAGE) break;
  }
  return issues;
}

// GitHub lists pull requests as issues too; the board takes issues only.
function isIssue(value: unknown): value is GithubIssue {
  const issue = value as GithubIssue;
  return (
    !!issue &&
    !issue.pull_request &&
    Number.isInteger(issue.number) &&
    typeof issue.title === "string" &&
    (issue.state === "open" || issue.state === "closed") &&
    typeof issue.html_url === "string" &&
    issue.html_url.startsWith("https://github.com/")
  );
}

function addTask(issue: GithubIssue, input: GithubImportInput): void {
  const body = (issue.body ?? "").trim();
  const task: TaskItem = {
    id: generateTaskId([...tasks.map((t) => t.id), ...taskStore.ids()]),
    title: issue.title.trim().slice(0, MAX_TITLE_LENGTH) || `#${issue.number}`,
    description: [issue.html_url, body.length > MAX_BODY_LENGTH ? `${body.slice(0, MAX_BODY_LENGTH)}…` : body].filter(Boolean).join("\n\n"),
    status: "open",
    roomId: input.roomId,
    createdBy: input.actor,
    createdAt: Date.now(),
    github: { repo: input.repo, number: issue.number, url: issue.html_url },
  };
  taskStore.commit(null, task, input.actor);
  tasks.push(task);
}

function updateTask(task: TaskItem, status: TaskItem["status"], actor: string): void {
  const next = { ...task, status };
  taskStore.commit(task, next, actor);
  tasks[tasks.indexOf(task)] = next;
}
