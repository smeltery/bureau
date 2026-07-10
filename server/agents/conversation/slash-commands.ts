import { commands, type CommandConfig, unsupportedMessage } from "../commands.ts";
import { addLogEntry, emitEphemeralLog, isAgentBusy, updateState, type ManagedAgent } from "../state.ts";
import { enqueueMessage } from "./message-queue.ts";
import { resolveSkillPrompt } from "../skills-discovery.ts";
import { SessionSwappedError } from "../session/runtime.ts";
import { runAgentTurn } from "../../plugins/run-agent-turn.ts";
import { commandHandlers } from "./slash-command-handlers.ts";

// Startup assertion: every supported command with a handler key must have a matching handler
for (const [name, cfg] of Object.entries(commands)) {
  if (cfg.supported && cfg.handler && !commandHandlers[cfg.handler]) {
    throw new Error(`Command /${name} is marked supported with handler "${cfg.handler}" but no handler exists`);
  }
}

// ---------------------------------------------------------------------------
// Slash command resolution — 5-step priority order (see docs/slash-command-design.md)
// ---------------------------------------------------------------------------

export async function handleSlashCommand(agentId: string, managed: ManagedAgent, cmd: string, args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  const cfg: CommandConfig | undefined = commands[cmd];

  // Step 1: Config lookup (non-overridable)
  if (cfg && !cfg.overridable) {
    if (cfg.supported && cfg.handler && commandHandlers[cfg.handler]) {
      return commandHandlers[cfg.handler](agentId, managed, args, rawText, username);
    }
    // Unsupported non-overridable command — show message
    emitEphemeralLog(agentId, "user_message", rawText, userMeta);
    emitEphemeralLog(agentId, "system", unsupportedMessage(cmd));
    return true;
  }

  // Step 2: Skill override check (for overridable config entries OR unknown commands)
  const skillPrompt = resolveSkillPrompt(cmd, managed.info.cwd);
  if (skillPrompt) {
    return executeSkill(agentId, managed, skillPrompt, args, rawText, username);
  }

  // Step 3: Config lookup (overridable, no skill found)
  if (cfg && cfg.overridable) {
    if (cfg.supported && cfg.handler && commandHandlers[cfg.handler]) {
      return commandHandlers[cfg.handler](agentId, managed, args, rawText, username);
    }
    // Unsupported overridable command with no skill override
    emitEphemeralLog(agentId, "user_message", rawText, userMeta);
    emitEphemeralLog(agentId, "system", unsupportedMessage(cmd));
    return true;
  }

  // Step 4: SDK-reported commands — pass through to the agent via session.send()
  if (managed.sdkReportedCommands.includes(cmd)) {
    return false; // let sendMessage() pass it through
  }

  // Step 5: Unknown command
  emitEphemeralLog(agentId, "user_message", rawText, userMeta);
  emitEphemeralLog(agentId, "system", `Unknown command \`/${cmd}\`. Type \`/help\` to see available commands.`);
  return true;
}

// Execute a resolved skill prompt by sending it to the agent
async function executeSkill(agentId: string, managed: ManagedAgent, skillPrompt: string, args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  const userArgs = args.join(" ");
  const fullPrompt = userArgs ? `${skillPrompt}\n\nUser context: ${userArgs}` : skillPrompt;

  // If the agent is mid-turn, defer the skill via the queue instead of
  // calling session.send now. Otherwise createTurnDeferred below would
  // supersede the in-flight turn and reject it with "Superseded by a new
  // turn". sendMessage's own queueing gate lets all slash commands skip
  // the queue — which is right for immediate handlers like /clear or
  // /bureau-diff, but wrong for skills that actually run the model.
  // Multi-step pending flows still take the immediate path: the user's
  // reply during /resume etc. is a pick, not a skill.
  const inMultiStep = !!(managed.pendingPermission || managed.pendingResume || managed.pendingModelPick || managed.pendingEffortPick);
  if (isAgentBusy(managed.info.state) && !inMultiStep) {
    const result = enqueueMessage(agentId, {
      sender: { kind: "user", username },
      text: rawText,
      sdkText: fullPrompt,
    });
    if (!result.ok) {
      addLogEntry(agentId, "system", `Could not queue ${rawText}: ${result.error}`);
    }
    return true;
  }

  addLogEntry(agentId, "user_message", rawText, userMeta);
  const prefixedSkillPrompt = username ? `[${username}] ${fullPrompt}` : fullPrompt;
  try {
    await runAgentTurn({
      managed,
      visibleText: rawText,
      // For skills, the expanded skill prompt (with user args spliced in)
      // is the semantic user request — what the user effectively asked
      // the model to do. The raw `/grill` invocation is captured in
      // visibleText for display. Sender prefix is applied as sdkText.
      originalText: fullPrompt,
      sdkText: prefixedSkillPrompt,
      username: username ?? null,
      origin: "skill",
      humanInput: true,
    });
  } catch (err: any) {
    // runAgentTurn re-throws whatever the underlying turn threw and has
    // already cleaned up the pendingTurn deferred if session.send fell
    // before await turn. Per-site error semantics remain here.
    if (err instanceof SessionSwappedError) return true;
    addLogEntry(agentId, "error", `Skill error: ${err.message}`);
    updateState(agentId, "error");
  }
  return true;
}
