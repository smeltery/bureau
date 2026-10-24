import { requestSessionSummary } from "./summaries/activity.ts";
import { captureMetadataProvider } from "./metadata/provider.ts";
import { createTopicGenerator, normalizeTopic } from "./topics/generation.ts";
import { persistSessionTopic } from "../persistence.ts";
import { agents, emit, logCache, persistAll, type ManagedAgent } from "./state.ts";

let captureProvider: typeof captureMetadataProvider | undefined;

/** Install at server boot, or supply a fake provider in integration tests. */
export function installTopicGeneration(provider = captureMetadataProvider): () => void {
  const previous = captureProvider;
  captureProvider = provider;
  return () => {
    captureProvider = previous;
  };
}

const generator = createTopicGenerator<ManagedAgent>({
  generating(managed, value) {
    managed.topicGenerating = value;
    managed.info.topicGenerating = value;
    if (agents.get(managed.info.id) === managed) emit({ type: "agent_updated", agentId: managed.info.id, changes: { topicGenerating: value } });
  },
  apply(managed, topic, count) {
    managed.info.topic = topic;
    managed.info.topicStale = false;
    managed.topicMessageCount = count;
    emit({ type: "agent_updated", agentId: managed.info.id, changes: { topic, topicStale: false } });
    if (managed.sessionId) persistSessionTopic(managed.info.id, managed.sessionId, topic, count);
    persistAll();
  },
  onError: () => console.error("Topic generation failed"),
});

export function invalidateTopicGeneration(managed: ManagedAgent) {
  generator.invalidate(managed);
}

export function persistCurrentSessionTopic(agentId: string, managed: ManagedAgent) {
  requestSessionSummary(managed, true);
  invalidateTopicGeneration(managed);
  if (managed.sessionId) persistSessionTopic(agentId, managed.sessionId, normalizeTopic(managed.info.topic), managed.topicMessageCount);
}

export async function generateTopic(agentId: string, manual = false) {
  const managed = agents.get(agentId);
  if (!managed || !captureProvider || managed.topicGenerating || (!manual && normalizeTopic(managed.info.topic))) return;
  const sessionId = managed.sessionId;
  const session = managed.session;
  const { agentType, modelFamily, userId, room } = managed.info;
  try {
    const provider = captureProvider(managed.info, sessionId ?? "");
    if (!provider) return;
    await generator.generate(managed, {
      ...provider,
      topic: managed.info.topic,
      manual,
      entries: logCache.get(agentId) ?? [],
      isCurrent: () =>
        agents.get(agentId) === managed &&
        managed.sessionId === sessionId &&
        managed.session === session &&
        managed.info.agentType === agentType &&
        managed.info.modelFamily === modelFamily &&
        managed.info.userId === userId &&
        managed.info.room === room,
    });
  } catch {
    console.error("Could not prepare topic generation");
  }
}

export function setTopic(agentId: string, topic: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  invalidateTopicGeneration(managed);
  managed.info.topic = normalizeTopic(topic);
  managed.info.topicStale = false;
  const textCount = (logCache.get(agentId) ?? []).filter((entry) => entry.kind === "user_message" || entry.kind === "text" || entry.kind === "api_token_outbound").length;
  managed.topicMessageCount = textCount;
  emit({ type: "agent_updated", agentId, changes: { topic: managed.info.topic, topicStale: false } });
  if (managed.sessionId) persistSessionTopic(agentId, managed.sessionId, managed.info.topic, textCount);
  persistAll();
}

export function resetTopic(agentId: string) {
  void generateTopic(agentId, true);
}
