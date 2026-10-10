import { createHash } from "node:crypto";

type Environment = Record<string, string | undefined>;

export function openCodeChildEnvironment(env: Environment): Environment {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) => value !== undefined && name !== "BUREAU_AGENT_TOKEN" && name !== "BUREAU_APP_TOKEN" && (name === "OPENCODE_API_KEY" || !name.startsWith("OPENCODE_")),
    ),
  );
}

/** In-memory comparison only: credentials never identify a persistent directory. */
export function environmentRevision(env: Environment): string {
  return createHash("sha256")
    .update(JSON.stringify(Object.entries({ ...openCodeChildEnvironment(env), OPENCODE_BINARY: env.OPENCODE_BINARY }).sort(([a], [b]) => a.localeCompare(b))))
    .digest("hex");
}
