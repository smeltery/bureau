import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { resolveAgentToken, type AgentTokenIdentity } from "../tokens.ts";

export const AGENT_REFERENCE_TOPICS = {
  discovery: "Agent discovery and conversations",
  tasks: "Task board",
  affordances: "Files, diffs, previews, and terminal cards",
  apps: "Registered apps",
  pager: "Paging your manager",
  messaging: "Agent, remote boss, and scheduled messages",
  memory: "Durable memory",
  "conversation-lifecycle": "New conversations and handoffs",
  browser: "Experimental browser control",
  "privileged-operations": "Privileged office operations",
} as const;

export type AgentReferenceTopic = keyof typeof AGENT_REFERENCE_TOPICS;

const PRIVILEGED_TOPICS: ReadonlySet<AgentReferenceTopic> = new Set(["privileged-operations"]);

const topicNames = Object.keys(AGENT_REFERENCE_TOPICS) as AgentReferenceTopic[];
const referenceDir = join(import.meta.dir, "agent-reference");
const content = new Map(topicNames.map((topic) => [topic, readFileSync(join(referenceDir, `${topic}.md`), "utf8")]));

export const AGENT_REFERENCE_VERSION = createHash("sha256")
  .update(topicNames.map((topic) => `${topic}\0${content.get(topic)}`).join("\0"))
  .digest("hex")
  .slice(0, 12);

export function agentReferenceTopics(identity: AgentTokenIdentity) {
  return topicNames.filter((topic) => !PRIVILEGED_TOPICS.has(topic) || identity.privileged).map((topic) => ({ topic, description: AGENT_REFERENCE_TOPICS[topic] }));
}

export function agentReferenceContent(identity: AgentTokenIdentity, topic: string): string | undefined {
  if (!agentReferenceTopics(identity).some((entry) => entry.topic === topic)) {
    return undefined;
  }
  return content.get(topic as AgentReferenceTopic);
}

export function resolveAgentReferenceBearer(req: Request): AgentTokenIdentity | null {
  const header = req.headers.get("authorization");
  const match = header ? /^bearer[ \t]+(.+)$/i.exec(header.trim()) : null;
  return resolveAgentToken(match?.[1]?.trim() ?? null);
}
