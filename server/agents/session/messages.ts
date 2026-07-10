import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentState, Attachment } from "../../../shared/types.ts";
import { accumulateSessionUsage, appendLog, appendSessionUsageSnapshot, loadLogWithAncestors, saveFile } from "../../persistence.ts";
import { autocompleteCommands } from "../commands.ts";
import { agents, addLogEntry, emit, emitEphemeralLog, logCache, persistAll, updateState } from "../state.ts";
import { deduplicateSkills, discoverBundledSkills, discoverPluginSkills, discoverProjectSkills, discoverUserSkills } from "../skills-discovery.ts";
export { buildUserMessage } from "./user-message-builder.ts";

// ---------------------------------------------------------------------------
// Auth-error detection (shared by processMessage and runConsumer's catch block)
// ---------------------------------------------------------------------------

export const LOGIN_INSTRUCTIONS = `To authenticate:
1. Open the built-in terminal
2. Run \`claude\`
3. Type \`/login\`
4. Follow the auth flow

Once complete, it takes effect immediately for all Bureau agents.`;

const AUTH_ERROR_PATTERNS = /unauthori[zs]ed|not authenticated|authentication|auth.*expired|invalid.*token|login.*required|403|401/i;
export function isAuthError(text: string): boolean {
  return AUTH_ERROR_PATTERNS.test(text);
}

// ---------------------------------------------------------------------------
// Deriving agent state from SDK messages
// ---------------------------------------------------------------------------

export function deriveState(msg: SDKMessage): AgentState | null {
  switch (msg.type) {
    case "assistant": {
      const content = (msg as any).message?.content;
      if (Array.isArray(content) && content.some((b: any) => b.type === "tool_use")) {
        return "tool_executing";
      }
      return "thinking";
    }
    case "tool_progress":
      return "tool_executing";
    case "result":
      return "waiting_for_response";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Process SDK messages into log entries
// ---------------------------------------------------------------------------

export function processMessage(agentId: string, msg: SDKMessage) {
  const newState = deriveState(msg);
  if (newState) {
    updateState(agentId, newState);
  }

  switch (msg.type) {
    case "system": {
      const subtype = (msg as any).subtype;
      if (subtype === "init") {
        const sessionId = (msg as any).session_id;
        const managed = agents.get(agentId);
        if (managed && sessionId) {
          const hadPreviousSession = !!managed.sessionId;
          // Load prior log history if this session was seen before (walks fork ancestry)
          if (!managed.sessionId && sessionId) {
            const history = loadLogWithAncestors(agentId, sessionId);
            if (history.length > 0) {
              for (const entry of history) {
                emit({ type: "log_entry", entry });
              }
            }
          }
          // If we already had a session and got a new init, this is a /clear
          if (hadPreviousSession && sessionId !== managed.sessionId) {
            logCache.set(agentId, []);
            emit({ type: "clear_logs", agentId } as any);
            addLogEntry(agentId, "system", "Conversation cleared.");
          }
          managed.sessionId = sessionId;
          // Backfill: write any cached log entries that were created before sessionId was known
          if (!hadPreviousSession) {
            const cached = logCache.get(agentId) ?? [];
            for (const entry of cached) {
              appendLog(agentId, sessionId, entry);
            }
          }
          persistAll();
        }
        // Capture available slash commands and skills from init
        const sdkCommands: string[] = (msg as any).slash_commands ?? [];
        // Filter out MCP internal command names (mcp__...) — they clutter autocomplete
        const filteredSdkCommands = sdkCommands.filter((c) => !c.startsWith("mcp__"));
        // Store SDK-reported commands for pass-through resolution (step 4)
        if (managed) {
          managed.sdkReportedCommands = filteredSdkCommands;
        }
        // Autocomplete: config entries with autocomplete:true + all discovered skills
        // SDK-reported commands are NOT added to autocomplete (per design)
        // Skills are listed in priority order; deduplicate by name (highest priority wins)
        const discoveredSkills = managed ? [...discoverUserSkills(), ...discoverProjectSkills(managed.info.cwd), ...discoverPluginSkills(), ...discoverBundledSkills()] : [];
        const uniqueSkills = deduplicateSkills(discoveredSkills);
        const configCommands = autocompleteCommands();
        if (managed) {
          managed.slashCommands = configCommands;
          managed.skills = uniqueSkills;
        }
        emit({
          type: "slash_commands",
          agentId,
          commands: configCommands,
          skills: uniqueSkills,
        } as any);
      } else if (subtype === "local_command_output") {
        const content = (msg as any).content;
        if (content) {
          addLogEntry(agentId, "system", content);
        }
      }
      break;
    }
    case "assistant": {
      const message = (msg as any).message;
      const content = message?.content;
      if (!Array.isArray(content)) break;
      // The SDK injects synthetic assistant turns (model === "<synthetic>")
      // for things like usage-limit hits and queue-flush gaps. Persist
      // their text as system breadcrumbs so they don't render as
      // Claude-voiced messages and mislead the boss.
      const isSynthetic = message?.model === "<synthetic>";
      for (const block of content) {
        if (block.type === "text" && block.text) {
          addLogEntry(agentId, isSynthetic ? "system" : "text", block.text);
        } else if (block.type === "tool_use") {
          const managed = agents.get(agentId);
          if (managed) {
            managed.toolCallTimestamps.set(block.id, Date.now());
          }
          addLogEntry(agentId, "tool_call", block.name, {
            toolId: block.id,
            input: block.input,
          });
        } else if (block.type === "thinking" && block.thinking) {
          const managed = agents.get(agentId);
          const duration_ms = managed?.thinkingStartedAt ? Date.now() - managed.thinkingStartedAt : undefined;
          addLogEntry(agentId, "thinking", block.thinking, duration_ms != null ? { duration_ms } : undefined);
        }
      }
      break;
    }
    case "user": {
      const content = (msg as any).message?.content;
      if (!Array.isArray(content)) break;
      for (const block of content) {
        if (block.type === "tool_result") {
          const resultText =
            typeof block.content === "string"
              ? block.content
              : Array.isArray(block.content)
                ? block.content
                    .filter((c: any) => c.type === "text")
                    .map((c: any) => c.text)
                    .join("\n")
                : JSON.stringify(block.content);
          // Extract image blocks from tool result content
          let resultAttachments: Attachment[] | undefined;
          if (Array.isArray(block.content)) {
            const atts: Attachment[] = [];
            for (const c of block.content as any[]) {
              if (c.type === "image" && c.source?.type === "base64") {
                const decoded = Buffer.from(c.source.data, "base64");
                const att = saveFile(agentId, decoded, c.source.media_type, `image.${c.source.media_type.split("/")[1] ?? "png"}`);
                if (att) atts.push(att);
              }
            }
            if (atts.length > 0) resultAttachments = atts;
          }
          const managed = agents.get(agentId);
          const callStart = managed?.toolCallTimestamps.get(block.tool_use_id);
          const duration_ms = callStart ? Date.now() - callStart : undefined;
          if (managed && callStart) {
            managed.toolCallTimestamps.delete(block.tool_use_id);
          }
          addLogEntry(
            agentId,
            "tool_result",
            resultText.slice(0, 10000),
            {
              toolUseId: block.tool_use_id,
              ...(duration_ms != null ? { duration_ms } : {}),
              ...(block.is_error === true ? { isError: true } : {}),
            },
            resultAttachments,
          );
        }
      }
      break;
    }
    case "result": {
      // SDK reports tokens per-turn and cost cumulative-per-process on every
      // `result`. We accumulate tokens and overwrite cost into sessions.json
      // (`usage`) and append the resulting cumulative as a snapshot anchored
      // to the most recently written log entry. The snapshots let /usage's
      // fork accounting subtract the parent's cumulative-at-the-fork-point
      // exactly, instead of double-counting the resumed prefix.
      // Only trust usage from success results. Error-subtype results may omit
      // `usage` entirely, and `?? 0` would overwrite the accurate cumulative
      // with zeros.
      const managed = agents.get(agentId);
      const usageField = (msg as any).usage;
      if (managed?.sessionId && usageField) {
        const cost = (msg as any).total_cost_usd ?? 0;
        const cumulative = accumulateSessionUsage(
          agentId,
          managed.sessionId,
          {
            inputTokens: usageField.input_tokens ?? 0,
            outputTokens: usageField.output_tokens ?? 0,
            cacheReadInputTokens: usageField.cache_read_input_tokens ?? 0,
            cacheCreationInputTokens: usageField.cache_creation_input_tokens ?? 0,
          },
          cost,
        );
        if (managed.lastWrittenEntryId) {
          appendSessionUsageSnapshot(agentId, managed.sessionId, managed.lastWrittenEntryId, cumulative);
        }
      }
      const subtype = (msg as any).subtype;
      if (subtype !== "success") {
        const errors = (msg as any).errors;
        const errorText = `Agent stopped: ${subtype}. ${errors?.join(", ") || ""}`;
        addLogEntry(agentId, "error", errorText);
        if (isAuthError(errorText)) {
          emitEphemeralLog(agentId, "system", LOGIN_INSTRUCTIONS);
        }
        updateState(agentId, "error");
      }
      break;
    }
  }
}
