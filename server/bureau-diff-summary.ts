import type { DiffFileSummary } from "../shared/types.ts";

export function applyNameStatus(fileMap: Map<string, DiffFileSummary>, nameStatus: string): void {
  if (!nameStatus) return;
  for (const line of nameStatus.split("\n")) {
    const cols = line.split("\t");
    const code = cols[0] ?? "";
    let status: DiffFileSummary["status"];
    let oldPath: string | undefined;
    let newPath: string;
    if (code.startsWith("R")) {
      status = "renamed";
      oldPath = cols[1] ?? "";
      newPath = cols[2] ?? "";
    } else if (code.startsWith("C")) {
      status = "copied";
      oldPath = cols[1] ?? "";
      newPath = cols[2] ?? "";
    } else if (code === "A") {
      status = "added";
      newPath = cols[1] ?? "";
    } else if (code === "D") {
      status = "deleted";
      newPath = cols[1] ?? "";
    } else {
      status = "modified";
      newPath = cols[1] ?? "";
    }
    if (!newPath) continue;
    fileMap.set(newPath, {
      path: newPath,
      oldPath,
      status,
      additions: 0,
      deletions: 0,
      lineCount: 0,
      inlineEligible: false,
    });
  }
}

export function applyNumstat(fileMap: Map<string, DiffFileSummary>, numstat: string): void {
  if (!numstat) return;
  for (const line of numstat.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const addRaw = parts[0]!;
    const delRaw = parts[1]!;
    const path = extractPostImagePath(parts.slice(2).join("\t"));
    const isBinary = addRaw === "-" && delRaw === "-";
    const additions = isBinary ? 0 : parseInt(addRaw, 10) || 0;
    const deletions = isBinary ? 0 : parseInt(delRaw, 10) || 0;
    const existing = fileMap.get(path);
    if (existing) {
      existing.additions = additions;
      existing.deletions = deletions;
      existing.lineCount = additions + deletions;
      if (isBinary) existing.status = "binary";
    } else {
      fileMap.set(path, {
        path,
        status: isBinary ? "binary" : "modified",
        additions,
        deletions,
        lineCount: additions + deletions,
        inlineEligible: false,
      });
    }
  }
}

// numstat formats renames as `old => new` or `prefix{old => new}suffix`;
// pull the post-image path so we merge counts into the name-status row.
export function extractPostImagePath(raw: string): string {
  const brace = raw.match(/^(.*)\{([^{}]*?) => ([^{}]*?)\}(.*)$/);
  if (brace) return `${brace[1]}${brace[3]}${brace[4]}`.replace(/\/{2,}/g, "/");
  const arrow = raw.indexOf(" => ");
  if (arrow !== -1) return raw.slice(arrow + 4);
  return raw;
}
