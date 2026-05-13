import { unstable_v2_prompt } from "@anthropic-ai/claude-agent-sdk";
import { persistSessionTopic } from "../persistence.ts";
import { agents, emit, logCache, persistAll, updateManifest, type ManagedAgent } from "./state.ts";

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
  const textEntries = logs.filter((e) => e.kind === "user_message" || e.kind === "text");
  const firstUserMsg = textEntries.find((e) => e.kind === "user_message");
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
    const recent = lastFive.filter((e) => e.id !== firstUserMsg.id);
    context = `First message: ${firstUserMsg.content}\n\nRecent conversation:\n` + recent.map((e) => `${e.kind === "user_message" ? "User" : "Assistant"}: ${e.content.slice(0, 200)}`).join("\n");
  }

  // System framing matters: without it, Sonnet occasionally roleplayed as
  // the agent in the conversation and "responded" to the task (e.g. asking
  // for file access) instead of labelling. Wrapping the snippet in a tag
  // and pinning the model to a labeller role suppresses that.
  const topicSystemPrompt = `You are a labelling tool. You receive a snippet of a conversation between a user and an AI assistant and you output a short topic label that summarizes what the conversation is about. You are NOT the assistant in the conversation, you do NOT have access to any files or systems mentioned, and you must NOT attempt to do the task. You only label.`;
  const prompt = `<conversation>\n${context}\n</conversation>\n\nOutput ONLY a topic label, max 8 words. No quotes, no trailing punctuation.`;

  try {
    // One-shot label task: no tools, no extended thinking, no filesystem
    // context. `permissionMode: "plan"` had been adding a planning system
    // prompt + adaptive thinking, which produced 200+-token outputs, ~10s+
    // latency, and a ~20% rate of the model roleplaying as an agent
    // attempting the conversation's task. cwd:"/tmp" + settingSources:[]
    // prevents the caller's cwd from leaking git/dir context into the
    // prompt (which made the model occasionally label with an unrelated
    // recent commit).
    const result = await unstable_v2_prompt(prompt, {
      model: "claude-sonnet-4-20250514",
      tools: [],
      thinking: { type: "disabled" },
      settingSources: [],
      cwd: "/tmp",
      systemPrompt: topicSystemPrompt,
    } as any);
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
  const textCount = (logCache.get(agentId) ?? []).filter((e) => e.kind === "user_message" || e.kind === "text").length;
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
