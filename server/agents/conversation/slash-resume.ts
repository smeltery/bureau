import { logMessage } from "../../../shared/i18n/log-message.ts";
import { listAgentSessions } from "../../persistence.ts";
import { emitEphemeralLog, updateState, type ManagedAgent } from "../state.ts";
import { tildifyCwd } from "../session/paths.ts";

export async function handleResumeCommand(agentId: string, managed: ManagedAgent, _args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  emitEphemeralLog(agentId, "user_message", rawText, userMeta);
  const sessions = listAgentSessions(agentId);
  if (sessions.length === 0) {
    emitEphemeralLog(agentId, "system", logMessage("logs.choice.noSessions"));
    updateState(agentId, "waiting_for_response");
    return true;
  }
  const lines: string[] = ["Resume a past conversation:\n"];
  const pickable: typeof sessions = [];
  for (const s of sessions.slice(0, 20)) {
    const date = new Date(s.lastModified);
    const dateStr = date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const rawLabel = s.topic || s.sessionId.slice(0, 8) + "...";
    const label = s.forked ? `↳ ${rawLabel}` : rawLabel;
    const suffix = s.branched ? "  (branched)" : "";
    const cwdStr = s.cwd ? `  ${tildifyCwd(s.cwd)}` : "";
    if (s.sessionId === managed.sessionId) {
      lines.push(`  \u25cf ${label}  ${dateStr}${cwdStr}  (current)`);
    } else {
      lines.push(`  ${pickable.length + 1}. ${label}  ${dateStr}${cwdStr}${suffix}`);
      pickable.push(s);
    }
  }
  if (pickable.length === 0) {
    emitEphemeralLog(agentId, "system", logMessage("logs.choice.noOtherSessions"));
    updateState(agentId, "waiting_for_response");
    return true;
  }
  const instruction = "\nReply with a number to resume, or anything else to cancel.";
  lines.push(instruction);
  emitEphemeralLog(agentId, "system", lines.join("\n"), {
    choicePrompt: {
      kind: "resume",
      title: "Resume a past conversation",
      titleMessage: logMessage("logs.choice.resume"),
      instruction: instruction.trim(),
      instructionMessage: logMessage("logs.choice.resumeInstruction"),
      choices: pickable.map((session) => {
        const date = new Date(session.lastModified);
        const dateStr = date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        const label = session.topic || `${session.sessionId.slice(0, 8)}...`;
        const details = [dateStr, session.cwd ? tildifyCwd(session.cwd) : null, session.branched ? "branched" : null].filter(Boolean).join("  ");
        return {
          value: session.sessionId,
          label,
          description: details || undefined,
          descriptionMessage: logMessage("logs.choice.sessionDetails", {
            date: { timestamp: session.lastModified },
            cwd: session.cwd ? `  ${tildifyCwd(session.cwd)}` : "",
            branch: session.branched ? logMessage("logs.choice.branchSuffix") : "",
          }),
        };
      }),
    },
  });
  managed.pendingResume = true;
  managed.pendingResumeSessions = pickable;
  updateState(agentId, "waiting_for_response");
  return true;
}
