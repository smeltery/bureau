import { compressUi } from "./compress.ts";
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
  const bundledEntry = paths.find((path) => /^entry-[a-z0-9]+\.js$/i.test(path)) ?? (paths.includes("index.js") ? "index.js" : undefined);
  if (!paths.includes("index.html") || !bundledEntry) throw new Error("UI build is missing its entry files.");
  const hash = createHash("sha256");
  for (const path of paths)
    hash
      .update(path)
      .update("\0")
      .update(readFileSync(join(stage, path)))
      .update("\0");
  const id = hash.digest("hex").slice(0, 24);
  const entry = bundledEntry === "index.js" ? `index-${id}.js` : bundledEntry;
  if (bundledEntry !== entry) renameSync(join(stage, bundledEntry), join(stage, entry));
  const html = readFileSync(join(stage, "index.html"), "utf8");
  if (!html.includes('src="./index.js"')) throw new Error("UI HTML has no bundle entry.");
  writeFileSync(join(stage, "index.html"), html.replace('src="./index.js"', `src="./${entry}"`).replace("<head>", `<head>\n  <meta name="bureau-ui-build" content="${id}" />`));
  compressUi(stage);
  mkdirSync(destination, { recursive: true });
  const currentAssets = files(stage).filter((name) => /\.js(?:\.(br|gz))?$/.test(name));
  const manifestPath = join(destination, "ui-build-assets.json");
  let oldManifest: { id?: string; current?: string[]; previous?: string[] } = {};
  if (existsSync(manifestPath)) oldManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const priorAssets = (oldManifest.id === id ? oldManifest.previous : oldManifest.current) ?? readdirSync(destination).filter((name) => /\.js(?:\.(br|gz))?$/.test(name));
  writeFileSync(join(stage, "ui-build-assets.json"), JSON.stringify({ id, current: currentAssets, previous: priorAssets }));
  const previous = new Map<string, Buffer | null>();
  try {
    for (const path of [...files(stage).filter((path) => !/^index\.html(?:\.(br|gz))?$/.test(path)), "index.html.br", "index.html.gz", "index.html"]) {
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
  const keep = new Set([...currentAssets, ...priorAssets]);
  for (const name of readdirSync(destination)) {
    if (/^(?:index(?:-[a-f0-9]{24})?|entry-[a-z0-9]+|chunk-[a-z0-9]+)\.js(?:\.(br|gz))?$/i.test(name) && !keep.has(name)) {
      try {
        rmSync(join(destination, name));
      } catch {
        console.warn(`UI published, but obsolete asset could not be removed: ${name}`);
      }
    }
  }
  return id;
}
if (import.meta.main) publishUi(resolve(process.argv[2]), resolve(process.argv[3]));
