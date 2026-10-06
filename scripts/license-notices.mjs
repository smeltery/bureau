import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

export const PROJECT_LICENSE_FILES = [
  "LICENSE",
  "NOTICE",
  "LICENSING.md",
  "LICENSES/smeltery-MIT.txt",
  "docs/investigations/licensing-provenance-2026-10.md",
  "deploy/container/seccomp/LICENSE",
];

export async function copyLicenseNotices(outputDirectory) {
  for (const filename of PROJECT_LICENSE_FILES) {
    const destination = join(outputDirectory, filename);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(repositoryRoot, filename), destination);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: license-notices.mjs <output-directory>");
  await copyLicenseNotices(resolve(process.argv[2]));
}
