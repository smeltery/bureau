import { randomUUID } from "node:crypto";
import { claim, exerciseOffice } from "./client.ts";

const name = `bureau-install-${randomUUID().slice(0, 8)}`;
const image = process.env.BUREAU_VERIFY_IMAGE || "bureau-install:verify";
const origin = "https://office.install.test";
const key = `synthetic-${randomUUID()}`;
async function docker(...args: string[]): Promise<string> {
  const child = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  const errors = await new Response(child.stderr).text();
  if (await child.exited) throw new Error(`docker ${args[0]} failed: ${errors}`);
  return output.trim();
}
try {
  await docker(
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "-p",
    "127.0.0.1::10000",
    "-e",
    `BUREAU_PUBLIC_URL=${origin}`,
    "-e",
    `BUREAU_SETUP_KEY=${key}`,
    "-e",
    "ANTHROPIC_BASE_URL=http://127.0.0.1:9",
    "-e",
    "OPENAI_BASE_URL=http://127.0.0.1:9",
    image,
  );
  const base = `http://${await docker("port", name, "10000/tcp")}`;
  const cookie = await claim(base, origin, key);
  await exerciseOffice(base, origin, cookie, "/var/data/workspaces");
  console.log("PASS: Render image entrypoint");
} catch (error) {
  console.error(await docker("logs", name).catch(() => "Container log unavailable"));
  throw error;
} finally {
  await docker("rm", "-f", name).catch((error) => console.error("Container cleanup:", error));
}
