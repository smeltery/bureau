import { runClaudeOneShot } from "../backends/claude.ts";
import { persistSessionTopic } from "../persistence.ts";
import { agents, emit, logCache, persistAll, updateManifest, type ManagedAgent } from "./state.ts";

// Auto-regenerate the topic once this many new user_message+text entries have
// accumulated since the topic was last generated. The goal is catching
// "the conversation is now about a fundamentally different thing" (the same
// signal /clear gives explicitly), not chasing every subtle drift — a smaller
// number would burn Sonnet calls on minor shifts that the original topic
// still describes well enough. Users who want an earlier refresh have the ↻
// button in LogView (calls resetTopic, no threshold).
export const TOPIC_REGEN_THRESHOLD = 20;

// True when the conversation has accumulated enough new exchanges since the
// topic was generated that the topic likely no longer describes what the
// agent is actually working on. Used by the post-resume / post-restart /
// long-session triggers; the manual ↻ button uses the looser topicStale
// signal (any drift at all) via resetTopic directly.
export function shouldAutoRegenerateTopic(managed: ManagedAgent): boolean {
  if (!managed.info.topicStale) return false;
  if (managed.info.topic === null || managed.info.topic === "...") return false;
  const textCount = (logCache.get(managed.info.id) ?? []).filter((e) => e.kind === "user_message" || e.kind === "text").length;
  return textCount - managed.topicMessageCount >= TOPIC_REGEN_THRESHOLD;
}

// Persist an agent's current in-memory topic into sessions.json so that the
// /resume list can display it later. Skips the transient "..." placeholder.
export function persistCurrentSessionTopic(agentId: string, managed: ManagedAgent) {
  if (managed.sessionId && managed.info.topic && managed.info.topic !== "...") {
    persistSessionTopic(agentId, managed.sessionId, managed.info.topic, managed.topicMessageCount);
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
    const result = await runClaudeOneShot(prompt, {
      model: "claude-sonnet-4-20250514",
      tools: [],
      thinking: { type: "disabled" },
      settingSources: [],
      cwd: "/tmp",
      systemPrompt: topicSystemPrompt,
    });
    if (result.subtype === "success" && agents.has(agentId)) {
      const topic = result.result.trim().slice(0, 80);
      managed.info.topic = topic;
      managed.info.topicStale = false;
      managed.topicMessageCount = textEntries.length;
      emit({ type: "agent_updated", agentId, changes: { topic, topicStale: false } });
      persistAll();
      // Persist topic + the textCount at which it was generated, so that on
      // resume/restart we can compute drift against the replayed history and
      // decide whether to auto-refresh.
      if (managed.sessionId) {
        persistSessionTopic(agentId, managed.sessionId, topic, textEntries.length);
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
  // Persist to sessions.json so resume list shows the manual topic; the
  // count anchors future drift detection to the moment the user signed off.
  if (managed.sessionId) {
    persistSessionTopic(agentId, managed.sessionId, managed.info.topic, textCount);
  }
  updateManifest();
}

export function resetTopic(agentId: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  generateTopic(agentId); // fire-and-forget
}
