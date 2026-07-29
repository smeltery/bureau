import type { AgentInfo } from "../../shared/types.ts";
import { persistSessionCwd } from "../persistence.ts";
import { moveClaudeSessionFile, resolveCwd } from "./session/paths.ts";
import { buildSessionEnv, createSession, replaceSession } from "./session/runtime.ts";
import { agents, emit, logCache, persistAll } from "./state.ts";
import { mintAgentToken } from "./tokens.ts";

export async function editAgent(
  agentId: string,
  changes: {
    name?: string;
    cwd?: string;
    outfit?: AgentInfo["outfit"];
    customInstructions?: string;
    modelFamily?: string;
    permissionMode?: AgentInfo["permissionMode"];
    codexSandbox?: AgentInfo["codexSandbox"];
    effort?: AgentInfo["effort"];
  },
) {
  const managed = agents.get(agentId);
  if (!managed) return;

  const updated: Partial<AgentInfo> = {};

  if (changes.name && changes.name !== managed.info.name) {
    // Reject duplicate names.
    const nameLower = changes.name.trim().toLowerCase();
    const duplicate = [...agents.values()].some((a) => a.info.id !== agentId && a.info.name.toLowerCase() === nameLower);
    if (!duplicate) {
      managed.info.name = changes.name;
      updated.name = changes.name;
    }
  }
  // cwd is a property of the session: changing it retargets the agent's active
  // session. The live backend process's cwd is fixed at spawn, so the actual
  // work — the Claude file move, the Codex thread drop, the stored-cwd stamp —
  // is deferred into the replace block below (which always runs for a cwd
  // change) so it can resume the relocated session in one step. Here we only
  // capture the pre-mutation cwd + env and switch the mirror. Build env BEFORE
  // mutating cwd so the move targets the CLAUDE_CONFIG_DIR the spawn was using;
  // best-effort, since a broken envFile shouldn't block the edit on a config error.
  let cwdChanging = false;
  let oldCwd = managed.info.cwd;
  let cwdMoveEnv: { [key: string]: string | undefined } | undefined;
  if (changes.cwd) {
    const resolvedNew = resolveCwd(changes.cwd);
    if (resolvedNew !== managed.info.cwd) {
      cwdChanging = true;
      oldCwd = managed.info.cwd;
      try {
        cwdMoveEnv = buildSessionEnv(managed);
      } catch {
        cwdMoveEnv = undefined;
      }
      managed.info.cwd = resolvedNew;
      updated.cwd = resolvedNew;
    }
  }
  if (changes.outfit) {
    managed.info.outfit = changes.outfit;
    updated.outfit = changes.outfit;
  }
  if (changes.customInstructions !== undefined && changes.customInstructions !== managed.info.customInstructions) {
    managed.info.customInstructions = changes.customInstructions || null;
    updated.customInstructions = managed.info.customInstructions;
  }
  if (changes.modelFamily && changes.modelFamily !== managed.info.modelFamily) {
    managed.info.modelFamily = changes.modelFamily;
    updated.modelFamily = changes.modelFamily;
  }
  if (changes.permissionMode && changes.permissionMode !== managed.info.permissionMode) {
    managed.info.permissionMode = changes.permissionMode;
    updated.permissionMode = changes.permissionMode;
  }
  if (changes.codexSandbox && changes.codexSandbox !== managed.info.codexSandbox) {
    managed.info.codexSandbox = changes.codexSandbox;
    updated.codexSandbox = changes.codexSandbox;
  }
  if (changes.effort && changes.effort !== managed.info.effort) {
    managed.info.effort = changes.effort;
    updated.effort = changes.effort;
  }

  if (Object.keys(updated).length === 0) return;

  // System prompt is passed into every createSession, so name/customInstructions
  // changes automatically apply to the next conversation.

  const isClaude = managed.info.agentType === "claude";
  const settingsReplace = !!(updated.modelFamily || updated.permissionMode || updated.codexSandbox || updated.effort);
  // A cwd change retargets the active session — the live backend process's cwd
  // is fixed at spawn, so it must be replaced. Settings changes (model /
  // permission / sandbox / effort) replace regardless so they take effect now.
  const needReplace = settingsReplace || cwdChanging;

  if (needReplace) {
    const codexCwdChange = cwdChanging && !isClaude;

    // Claude cwd change: relocate the active session's files to the new project
    // dir BEFORE the resume so createSession finds them there. A failed move
    // means Claude can't locate the .jsonl, so abort the cwd change (roll the
    // mirror back, reverse any partial move) rather than stamp the session into
    // a cwd it can't be resumed from.
    if (cwdChanging && isClaude && managed.sessionId) {
      const target = managed.info.cwd;
      const moved = moveClaudeSessionFile(managed.sessionId, oldCwd, target, cwdMoveEnv);
      if (!moved.ok) {
        managed.info.cwd = oldCwd;
        delete updated.cwd;
        let reversed = true;
        if (moved.moved) reversed = moveClaudeSessionFile(managed.sessionId, target, oldCwd, cwdMoveEnv).ok;
        throw new Error(
          `Failed to move session files to ${target}: ${moved.error}. ` +
            (reversed
              ? `cwd change aborted; the session stays in ${oldCwd}.`
              : `cwd change aborted, but the session files could not be moved back and now live in ${target}; resume may fail until they are restored.`),
        );
      }
    }

    // Codex can't carry a cwd across a resume (thread/resume ignores cwd), so a
    // cwd change abandons the thread and starts a fresh one in the new cwd. Wipe
    // the prior conversation (mirrors newConversation) so the fresh thread
    // doesn't inherit stale log history bound to the old cwd. The old thread's
    // rollout stays on disk, resumable via /resume.
    if (codexCwdChange) {
      managed.sessionId = null;
      logCache.set(agentId, []);
      emit({ type: "clear_logs", agentId });
      managed.topicMessageCount = 0;
      managed.info.topic = null;
      managed.info.topicStale = false;
      updated.topic = null;
      updated.topicStale = false;
    }

    const resumeId = managed.sessionId;
    const newSession = resumeId ? createSession(managed, resumeId) : createSession(managed);
    await replaceSession(agentId, managed, newSession);

    // Stamp the active Claude session's new cwd as source of truth. Fresh
    // sessions (the Codex cwd change, or a from-scratch session) get stamped by
    // system_init's ensureSessionCwd instead.
    if (cwdChanging && isClaude && managed.sessionId) {
      persistSessionCwd(agentId, managed.sessionId, managed.info.cwd);
    }
  }

  persistAll();
  emit({ type: "agent_updated", agentId, changes: updated });
}

export async function setAgentPrivileged(agentId: string, privileged: boolean): Promise<AgentInfo | null> {
  const managed = agents.get(agentId);
  if (!managed) return null;
  const previous = managed.info.privileged ?? false;
  if (previous === privileged) return managed.info;

  managed.info.privileged = privileged;
  mintAgentToken(agentId, managed.info.userId ?? null, privileged);

  try {
    if (managed.session) {
      const resumeId = managed.sessionId;
      const newSession = resumeId ? createSession(managed, resumeId) : createSession(managed);
      await replaceSession(agentId, managed, newSession);
    }
  } catch (err) {
    managed.info.privileged = previous;
    mintAgentToken(agentId, managed.info.userId ?? null, previous);
    throw err;
  }

  persistAll();
  emit({ type: "agent_updated", agentId, changes: { privileged } });
  return managed.info;
}
