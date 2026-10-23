import { logMessage } from "../../../shared/i18n/log-message.ts";
import { computeBureauDiff, resolveDiffCwd } from "../../bureau-diff.ts";
import { resolveEditorPath, openFile as openEditorFile } from "../../file-editor.ts";
import { addLogEntry, agents, rooms, updateState, type ManagedAgent } from "../state.ts";
import { enqueueMessage } from "./message-queue.ts";

export async function handleBureauEditCommand(agentId: string, managed: ManagedAgent, args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  addLogEntry(agentId, "user_message", rawText, userMeta);

  const rawPath = args[0];
  if (!rawPath) {
    addLogEntry(agentId, "system", logMessage("logs.command.editUsage", { command: "/bureau-edit <path>", cwd: managed.info.cwd }));
    updateState(agentId, "waiting_for_response");
    return true;
  }
  const resolved = resolveEditorPath(rawPath, managed.info.cwd);
  if (resolved.kind === "bad_path") {
    addLogEntry(agentId, "system", logMessage("logs.command.emptyPath"));
    updateState(agentId, "waiting_for_response");
    return true;
  }
  const probe = openEditorFile(resolved.path);
  if (probe.kind === "not_found") {
    addLogEntry(agentId, "system", logMessage("logs.command.missingFile", { path: resolved.path }));
  } else if (probe.kind === "not_file") {
    addLogEntry(agentId, "system", logMessage("logs.command.notFile", { path: resolved.path }));
  } else if (probe.kind === "binary") {
    addLogEntry(agentId, "system", logMessage("logs.command.binaryFile", { path: resolved.path }));
  } else if (probe.kind === "too_large") {
    addLogEntry(agentId, "system", logMessage("logs.command.largeFile", { path: resolved.path, size: (probe.size / 1024).toFixed(1) }));
  } else if (probe.kind === "io_error") {
    addLogEntry(agentId, "system", logMessage("logs.command.openFailed", { path: resolved.path, error: probe.message }));
  } else {
    addLogEntry(agentId, "edit-request", resolved.path, undefined, undefined, { file: { path: resolved.path } });
  }
  updateState(agentId, "waiting_for_response");
  return true;
}

export async function handleBureauMessageCommand(agentId: string, managed: ManagedAgent, args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  addLogEntry(agentId, "user_message", rawText, userMeta);

  const targetArg = args[0];
  const text = args.slice(1).join(" ").trim();
  const others = [...agents.values()].filter((a) => a.info.id !== agentId);

  if (!targetArg || !text) {
    const peers =
      others.length === 0
        ? logMessage("logs.command.noPeers")
        : logMessage("logs.command.peers", {
            agents: others.map((a) => `  **${a.info.name}**  \`${a.info.id}\``).join("\n"),
          });
    addLogEntry(agentId, "system", logMessage("logs.command.messageHelp", { usage: logMessage("logs.command.messageUsage", { command: "/bureau-message <agent-name-or-id> <message>" }), peers }));
    updateState(agentId, "waiting_for_response");
    return true;
  }

  const self = managed.info;
  if (targetArg === self.id || targetArg.toLocaleLowerCase() === self.name.toLocaleLowerCase()) {
    addLogEntry(agentId, "system", logMessage("logs.command.messageSelf"));
    updateState(agentId, "waiting_for_response");
    return true;
  }

  const byId = others.find((a) => a.info.id === targetArg);
  const byName = byId ? [] : others.filter((a) => a.info.name.toLocaleLowerCase() === targetArg.toLocaleLowerCase());
  const target = byId ?? (byName.length === 1 ? byName[0] : null);

  if (!target) {
    if (byName.length > 1) {
      const ids = byName.map((a) => `  \`${a.info.id}\``).join("\n");
      addLogEntry(agentId, "system", logMessage("logs.command.duplicateAgents", { name: targetArg, ids }));
    } else {
      addLogEntry(agentId, "system", logMessage("logs.command.noAgentMatch", { name: targetArg }));
    }
    updateState(agentId, "waiting_for_response");
    return true;
  }

  const sender = { kind: "agent" as const, agentId, agentName: managed.info.name, roomName: rooms[managed.info.room]!.name };
  const result = enqueueMessage(target.info.id, { sender, text });
  if (result.ok) {
    addLogEntry(agentId, "system", logMessage(result.queued ? "logs.command.messageQueued" : "logs.command.messageDelivered", { name: target.info.name }));
  } else {
    addLogEntry(agentId, "system", logMessage("logs.command.messageFailed", { name: target.info.name, error: result.error }));
  }
  updateState(agentId, "waiting_for_response");
  return true;
}

export async function handleBureauDiffCommand(agentId: string, managed: ManagedAgent, args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  addLogEntry(agentId, "user_message", rawText, userMeta);

  const resolved = resolveDiffCwd(args[0], managed.info.cwd);
  if (resolved.kind === "bad_dir") {
    addLogEntry(agentId, "system", logMessage("logs.command.notDirectory", { cwd: resolved.attempted }));
    updateState(agentId, "waiting_for_response");
    return true;
  }

  const result = computeBureauDiff(resolved.cwd);
  switch (result.kind) {
    case "not_repo":
      addLogEntry(agentId, "system", logMessage("logs.command.notRepository", { cwd: result.cwd }));
      break;
    case "git_error":
      addLogEntry(agentId, "system", logMessage("logs.command.diffFailed", { cwd: result.cwd, error: result.message }));
      break;
    case "clean":
      addLogEntry(agentId, "system", logMessage("logs.command.cleanTree", { cwd: result.cwd }));
      break;
    case "ok":
      addLogEntry(agentId, "diff", result.summary, undefined, undefined, { diff: result.payload });
      break;
  }
  updateState(agentId, "waiting_for_response");
  return true;
}
