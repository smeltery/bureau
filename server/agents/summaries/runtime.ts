import type { AgentInfo } from "../../../shared/types.ts";
import { readSessionSummary, persistSessionSummary } from "../../persistence/logs/summary.ts";
import { captureMetadataProvider, type MetadataProviderDependencies } from "../metadata/provider.ts";
import { installSummaryRequests } from "./activity.ts";
import { createSessionSummarizer, type SummaryDependencies } from "./summary.ts";

interface RunnerDependencies extends MetadataProviderDependencies {
  read: SummaryDependencies["read"];
  write: SummaryDependencies["write"];
  onError: SummaryDependencies["onError"];
}

/** Capture synchronously, then let ended sessions finish independently of their live agent. */
export function createSummaryRunner(overrides: Partial<RunnerDependencies> = {}) {
  const summarize = createSessionSummarizer({
    read: ({ agentId, sessionId }) => readSessionSummary(agentId, sessionId),
    write: ({ agentId, sessionId }, previous, summary, throughEntryId) => persistSessionSummary(agentId, sessionId, previous, summary, throughEntryId),
    onError: () => console.error("Conversation summary generation failed"),
    ...overrides,
  });
  return (managed: { info: AgentInfo }, sessionId: string): Promise<void> => {
    const provider = captureMetadataProvider(managed.info, sessionId, overrides);
    if (!provider) return Promise.resolve();
    return summarize({ agentId: managed.info.id, sessionId, ...provider });
  };
}

export function startConversationSummaries() {
  const run = createSummaryRunner();
  return installSummaryRequests((managed, sessionId) => {
    void run(managed, sessionId).catch(() => console.error("Conversation summary generation failed"));
  });
}
