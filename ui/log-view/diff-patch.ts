// Split a multi-file unified patch by `diff --git` boundaries. Path is read
// from the chunk's body (`+++ b/...` for adds/mods/renames-with-content,
// `rename to ...` for pure renames, `--- a/...` for deletions) which is much
// more reliable than parsing the `diff --git a/X b/Y` header — that line is
// ambiguous when paths contain spaces or " b/" substrings.
export function splitPatchByFile(patchText: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!patchText) return map;
  const lines = patchText.split("\n");
  let currentLines: string[] = [];
  const flush = () => {
    if (currentLines.length === 0) return;
    let plusBPath: string | null = null;
    let dashAPath: string | null = null;
    let renameToPath: string | null = null;
    let isDeletion = false;
    for (const l of currentLines) {
      if (l.startsWith("+++ /dev/null")) isDeletion = true;
      else if (plusBPath === null && l.startsWith("+++ b/")) plusBPath = l.slice(6);
      else if (dashAPath === null && l.startsWith("--- a/")) dashAPath = l.slice(6);
      else if (renameToPath === null && l.startsWith("rename to ")) renameToPath = l.slice(10);
    }
    const path = plusBPath ?? renameToPath ?? (isDeletion ? dashAPath : null);
    if (path !== null) map.set(path, currentLines.join("\n"));
  };
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      currentLines = [line];
    } else if (currentLines.length > 0) {
      currentLines.push(line);
    }
  }
  flush();
  return map;
}
