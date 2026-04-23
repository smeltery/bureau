import { unstable_v2_prompt } from "@anthropic-ai/claude-agent-sdk";
import { persistSessionTopic } from "../persistence.ts";
import {
  agents,
  emit,
  logCache,
  persistAll,
  updateManifest,
  type ManagedAgent,
} from "./state.ts";

// Persist an agent's current in-memory topic into sessions.json so that the
// /resume list can display it later. Skips the transient "..." placeholder.
export function persistCurrentSessionTopic(agentId: string, managed: ManagedAgent) {
  if (managed.sessionId && managed.info.topic && managed.info.topic !== "...") {
    persistSessionTopic(agentId, managed.sessionId, managed.info.topic);
  }
}

// Generate a short topic description for an agent's conversation
export async function generateTopic(agentId: string) {
  const managed = agents.get(agentId);
  if (!managed || managed.topicGenerating) return;

  managed.topicGenerating = true;
  managed.info.topic = "...";
  managed.info.topicStale = false;
  emit({ type: "agent_updated", agentId, changes: { topic: "...", topicStale: false } });

  // Build context: first user message + last 5 text entries
  const logs = logCache.get(agentId) ?? [];
  const textEntries = logs.filter(e => e.kind === "user_message" || e.kind === "text");
  const firstUserMsg = textEntries.find(e => e.kind === "user_message");
  if (!firstUserMsg) {
    managed.topicGenerating = false;
    managed.info.topic = null;
    emit({ type: "agent_updated", agentId, changes: { topic: null } });
    return;
  }

  const lastFive = textEntries.slice(-5);
  let context: string;
  if (textEntries.length <= 1) {
    context = `User message: ${firstUserMsg.content}`;
  } else {
    // Deduplicate if first message is already in lastFive
    const recent = lastFive.filter(e => e.id !== firstUserMsg.id);
    context = `First message: ${firstUserMsg.content}\n\nRecent conversation:\n` +
      recent.map(e => `${e.kind === "user_message" ? "User" : "Assistant"}: ${e.content.slice(0, 200)}`).join("\n");
  }

  const prompt = `${context}\n\nRespond with ONLY a short topic description for this conversation, max 8 words. No quotes, no punctuation at the end.`;

  try {
    const result = await unstable_v2_prompt(prompt, {
      model: "claude-sonnet-4-20250514",
      permissionMode: "plan",
    });
    if (result.subtype === "success" && agents.has(agentId)) {
      const topic = result.result.trim().slice(0, 80);
      managed.info.topic = topic;
      managed.info.topicStale = false;
      managed.topicMessageCount = textEntries.length;
      emit({ type: "agent_updated", agentId, changes: { topic, topicStale: false } });
      persistAll();
      // Persist topic to sessions.json for resume list
      if (managed.sessionId) {
        persistSessionTopic(agentId, managed.sessionId, topic);
      }
    }
  } catch (err: any) {
    console.error(`Topic generation failed for ${agentId}:`, err.message);
    // Silently fail — clear the "..." placeholder
    if (agents.has(agentId)) {
      managed.info.topic = null;
      emit({ type: "agent_updated", agentId, changes: { topic: null } });
    }
  } finally {
    managed.topicGenerating = false;
  }
}

export function setTopic(agentId: string, topic: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  managed.info.topic = topic.slice(0, 80);
  managed.info.topicStale = false;
  const textCount = (logCache.get(agentId) ?? []).filter(e => e.kind === "user_message" || e.kind === "text").length;
  managed.topicMessageCount = textCount;
  emit({ type: "agent_updated", agentId, changes: { topic: managed.info.topic, topicStale: false } });
  // Persist to sessions.json so resume list shows the manual topic
  if (managed.sessionId) {
    persistSessionTopic(agentId, managed.sessionId, managed.info.topic);
  }
  updateManifest();
}

export function resetTopic(agentId: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  generateTopic(agentId); // fire-and-forget
}
