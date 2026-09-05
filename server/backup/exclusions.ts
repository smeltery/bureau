import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { BACKEND_CREDENTIAL_PATHS, type BackendCredentialPath } from "./backend-credential-paths.ts";
import type { BackupConfig } from "./files.ts";

const RESTORE_REPORT_FILE = "RESTORE.txt";

interface BackupExclusion {
  id: string;
  matches: (relativePath: string) => boolean;
  report?: (paths: string[], stateRoot: string) => string[];
}

function backendExclusion(entry: BackendCredentialPath): BackupExclusion {
  return {
    id: entry.id,
    matches: (path) => entry.pattern.test(path),
    report: (paths, stateRoot) => backendReport(entry.id, paths, stateRoot),
  };
}

const BACKUP_EXCLUSIONS: readonly BackupExclusion[] = [
  { id: "restore-report", matches: (path) => path === RESTORE_REPORT_FILE },
  {
    id: "app-runtime-credentials",
    matches: (path) => path === "apps/units" || path.startsWith("apps/units/"),
    report: (paths) => {
      const apps = paths
        .filter((path) => path.endsWith(".env"))
        .map((path) => basename(path, ".env"))
        .sort();
      return [
        `- App runtime credentials were omitted${apps.length ? ` for: ${apps.join(", ")}` : ""}. Bureau re-mints them at startup. Start previously stopped apps from the Apps page when you need them.`,
      ];
    },
  },
  {
    id: "personal-environment",
    matches: (path) => path === "user-env" || path.startsWith("user-env/"),
    report: (paths, stateRoot) => personalEnvironmentReport(paths, stateRoot),
  },
  {
    id: "office-environment",
    matches: (path) => path === "office-env/office.env",
    report: () => [
      "- Office environment variables were omitted. An office owner must open User Settings > Connections > Environment variables > Variables for every agent in this office and enter them again. Then use /clear on affected agents.",
    ],
  },
  {
    id: "codex-shell-snapshots",
    matches: (path) => /(^|\/)(?:\.codex|codex-home)\/shell_snapshots(?:\/|$)/.test(path) || /^provider-homes\/[^/]+\/codex\/shell_snapshots(?:\/|$)/.test(path),
    report: () => ["- Codex shell snapshots were omitted because they can contain exported environment variables. Codex regenerates them; no action is required."],
  },
  {
    id: "legacy-tls-key",
    matches: (path) => path === "tls/cert.key",
    report: () => ["- The legacy state-root TLS private key was omitted. Bureau does not read this file, so nothing needs to be entered again."],
  },
  ...BACKEND_CREDENTIAL_PATHS.map(backendExclusion),
];

function stateRoot(config: BackupConfig): string {
  return join(config.stateRootParent, config.stateRootName);
}

function stateFiles(root: string): string[] {
  const files: string[] = [];
  function visit(directory: string, prefix: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath, relativePath);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(relativePath);
    }
  }
  if (existsSync(root) && lstatSync(root).isDirectory()) visit(root, "");
  return files;
}

function userNames(root: string): Map<string, string> {
  const names = new Map<string, string>();
  try {
    const parsed = JSON.parse(readFileSync(join(root, "users.json"), "utf8"));
    if (!Array.isArray(parsed)) return names;
    for (const user of parsed) {
      if (user && typeof user === "object" && typeof user.id === "string" && typeof user.name === "string") names.set(user.id, user.name);
    }
  } catch {}
  return names;
}

function personalEnvironmentReport(paths: string[], root: string): string[] {
  const names = userNames(root);
  const users = paths
    .filter((path) => /^user-env\/[^/]+\.env$/.test(path))
    .map((path) => basename(path, ".env"))
    .map((id) => names.get(id) ?? id)
    .sort();
  if (users.length === 0) return [];
  return [
    `- Personal environment variables were omitted for: ${users.map((name) => `user "${name}"`).join(", ")}. Each affected user must open User Settings > Connections > Environment variables > Variables for agents I spawn and enter them again. Then use /clear on affected agents.`,
  ];
}

function backendReport(id: BackendCredentialPath["id"], paths: string[], root: string): string[] {
  if (paths.length === 0) return [];
  const names = userNames(root);
  const owners = paths
    .map((path) => /^provider-homes\/([^/]+)\//.exec(path)?.[1])
    .filter((id): id is string => id !== undefined)
    .map((id) => names.get(id) ?? id)
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort();
  const forUsers = owners.length ? ` for: ${owners.map((name) => `user "${name}"`).join(", ")}` : "";
  if (id === "claude-login") return [`- Claude sign-in credentials were omitted${forUsers}. Each affected user must open User Settings > Connections > Claude and sign in again.`];
  if (id === "codex-login") return [`- Codex sign-in credentials were omitted${forUsers}. Each affected user must open User Settings > Connections > Codex and sign in again.`];
  if (id === "opencode-login")
    return [
      "- OpenCode provider credentials were omitted. Each affected user must open User Settings > Connections > Environment variables > Variables for agents I spawn, enter OPENCODE_API_KEY, and then use /clear on affected agents.",
    ];
  return ["- OpenCode MCP OAuth credentials were omitted. Reconnect each affected server with the profile-scoped command: opencode mcp auth <server-name>."];
}

function restoreReport(config: BackupConfig): string {
  const root = stateRoot(config);
  const files = stateFiles(root);
  const details = BACKUP_EXCLUSIONS.flatMap((entry) => {
    if (!entry.report) return [];
    const matched = files.filter(entry.matches);
    return matched.length > 0 ? entry.report(matched, root) : [];
  });
  return [
    "BUREAU RESTORE REPORT",
    "",
    "This backup omitted the credential files and regenerable secret caches listed below.",
    "This report does not claim that the archive is free of secrets.",
    "",
    ...(details.length ? details : ["No listed credential file or regenerable secret cache existed when this backup was made."]),
    "",
  ].join("\n");
}

function shouldExclude(relativePath: string): boolean {
  return BACKUP_EXCLUSIONS.some((entry) => entry.matches(relativePath));
}

export function stageBackupRoot(config: BackupConfig): string {
  const staging = mkdtempSync(join(tmpdir(), "bureau-backup-stage-"));
  const stagedRoot = join(staging, config.stateRootName);
  mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
  for (const relativePath of stateFiles(stateRoot(config))) {
    if (shouldExclude(relativePath)) continue;
    const target = join(stagedRoot, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(stateRoot(config), relativePath), target, { dereference: false, preserveTimestamps: true });
  }
  writeFileSync(join(stagedRoot, RESTORE_REPORT_FILE), restoreReport(config), { mode: 0o600 });
  return staging;
}

export function removeBackupStaging(staging: string): void {
  rmSync(staging, { recursive: true, force: true });
}
