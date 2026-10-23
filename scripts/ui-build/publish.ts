import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function files(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(prefix, entry.name);
      if (entry.isSymbolicLink()) throw new Error("UI build must not contain symbolic links.");
      return entry.isDirectory() ? files(root, path) : [path];
    })
    .sort();
}
/** Complete the build before replacing served files; publish the HTML entry last. */
export function publishUi(stage: string, destination: string) {
  const paths = files(stage);
  if (!paths.includes("index.html") || !paths.includes("index.js")) throw new Error("UI build is missing its entry files.");
  const hash = createHash("sha256");
  for (const path of paths)
    hash
      .update(path)
      .update("\0")
      .update(readFileSync(join(stage, path)))
      .update("\0");
  const id = hash.digest("hex").slice(0, 24);
  const entry = `index-${id}.js`;
  renameSync(join(stage, "index.js"), join(stage, entry));
  const html = readFileSync(join(stage, "index.html"), "utf8");
  if (!html.includes('src="./index.js"')) throw new Error("UI HTML has no bundle entry.");
  writeFileSync(join(stage, "index.html"), html.replace('src="./index.js"', `src="./${entry}"`).replace("<head>", `<head>\n  <meta name="bureau-ui-build" content="${id}" />`));
  mkdirSync(destination, { recursive: true });
  const previous = new Map<string, Buffer | null>();
  try {
    for (const path of [...files(stage).filter((path) => path !== "index.html"), "index.html"]) {
      const target = join(destination, path);
      previous.set(path, existsSync(target) ? readFileSync(target) : null);
      mkdirSync(dirname(target), { recursive: true });
      renameSync(join(stage, path), target);
    }
  } catch (error) {
    for (const [path, content] of [...previous].reverse()) {
      const target = join(destination, path);
      if (content === null) rmSync(target, { force: true });
      else {
        const temporary = `${target}.${crypto.randomUUID()}.rollback`;
        writeFileSync(temporary, content);
        renameSync(temporary, target);
      }
    }
    throw error;
  }
  // Keep the previous entry for tabs that fetched HTML just before publication.
  // Entries are small in number even when a checkout is rebuilt repeatedly.
  const previousHtml = previous.get("index.html")?.toString("utf8") ?? "";
  const priorEntry = /src="\.\/(index-[a-f0-9]{24}\.js)"/.exec(previousHtml)?.[1];
  if (priorEntry === entry) return id;
  for (const name of readdirSync(destination)) {
    if (/^index-[a-f0-9]{24}\.js$/.test(name) && name !== entry && name !== priorEntry) {
      try {
        rmSync(join(destination, name));
      } catch {
        console.warn(`UI published, but obsolete entry could not be removed: ${name}`);
      }
    }
  }
  return id;
}
if (import.meta.main) publishUi(resolve(process.argv[2]), resolve(process.argv[3]));
