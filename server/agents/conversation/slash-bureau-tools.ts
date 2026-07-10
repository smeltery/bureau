import { computeBureauDiff, resolveDiffCwd } from "../../bureau-diff.ts";
import { resolveEditorPath, openFile as openEditorFile } from "../../file-editor.ts";
import { addLogEntry, agents, rooms, updateState, type ManagedAgent } from "../state.ts";
import { enqueueMessage } from "./message-queue.ts";

export async function handleBureauEditCommand(agentId: string, managed: ManagedAgent, args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  addLogEntry(agentId, "user_message", rawText, userMeta);

  const rawPath = args[0];
  if (!rawPath) {
    addLogEntry(agentId, "system", `Usage: \`/bureau-edit <path>\`. Path can be relative (resolves against ${managed.info.cwd}), absolute, or \`~/...\`.`);
    updateState(agentId, "waiting_for_response");
    return true;
  }
  const resolved = resolveEditorPath(rawPath, managed.info.cwd);
  if (resolved.kind === "bad_path") {
    addLogEntry(agentId, "system", `Empty path.`);
    updateState(agentId, "waiting_for_response");
    return true;
  }
  const probe = openEditorFile(resolved.path);
  if (probe.kind === "not_found") {
    addLogEntry(agentId, "system", `\`${resolved.path}\` does not exist.`);
  } else if (probe.kind === "not_file") {
    addLogEntry(agentId, "system", `\`${resolved.path}\` is not a file.`);
  } else if (probe.kind === "binary") {
    addLogEntry(agentId, "system", `\`${resolved.path}\` is a binary file — the editor panel only supports text.`);
  } else if (probe.kind === "too_large") {
    addLogEntry(agentId, "system", `\`${resolved.path}\` is ${(probe.size / 1024).toFixed(1)} KB — too large for the editor panel (1 MB limit).`);
  } else if (probe.kind === "io_error") {
    addLogEntry(agentId, "system", `Failed to open \`${resolved.path}\`: ${probe.message}`);
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
    const lines = ["Usage: `/bureau-message <agent-name-or-id> <message>`"];
    if (others.length === 0) {
      lines.push("\nNo other agents to message.");
    } else {
      lines.push("\nOther agents:");
      for (const a of others) lines.push(`  **${a.info.name}**  \`${a.info.id}\``);
    }
    addLogEntry(agentId, "system", lines.join("\n"));
    updateState(agentId, "waiting_for_response");
    return true;
  }

  const self = managed.info;
  if (targetArg === self.id || targetArg.toLocaleLowerCase() === self.name.toLocaleLowerCase()) {
    addLogEntry(agentId, "system", "You can't message yourself.");
    updateState(agentId, "waiting_for_response");
    return true;
  }

  const byId = others.find((a) => a.info.id === targetArg);
  const byName = byId ? [] : others.filter((a) => a.info.name.toLocaleLowerCase() === targetArg.toLocaleLowerCase());
  const target = byId ?? (byName.length === 1 ? byName[0] : null);

  if (!target) {
    if (byName.length > 1) {
      const lines = [`Multiple agents are named "${targetArg}". Re-run with the id:`];
      for (const a of byName) lines.push(`  \`${a.info.id}\``);
      addLogEntry(agentId, "system", lines.join("\n"));
    } else {
      addLogEntry(agentId, "system", `No agent matches \`${targetArg}\`. Run \`/bureau-message\` with no arguments to list agents.`);
    }
    updateState(agentId, "waiting_for_response");
    return true;
  }

  const sender = { kind: "agent" as const, agentId, agentName: managed.info.name, roomName: rooms[managed.info.room]!.name };
  const result = enqueueMessage(target.info.id, { sender, text });
  if (result.ok) {
    addLogEntry(agentId, "system", result.queued ? `Queued for **${target.info.name}** (busy — will flush when idle).` : `Delivered to **${target.info.name}**.`);
  } else {
    addLogEntry(agentId, "system", `Could not message **${target.info.name}**: ${result.error}`);
  }
  updateState(agentId, "waiting_for_response");
  return true;
}

export async function handleBureauDiffCommand(agentId: string, managed: ManagedAgent, args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  addLogEntry(agentId, "user_message", rawText, userMeta);

  const resolved = resolveDiffCwd(args[0], managed.info.cwd);
  if (resolved.kind === "bad_dir") {
    addLogEntry(agentId, "system", `\`${resolved.attempted}\` is not a directory.`);
    updateState(agentId, "waiting_for_response");
    return true;
  }

  const result = computeBureauDiff(resolved.cwd);
  switch (result.kind) {
    case "not_repo":
      addLogEntry(agentId, "system", `\`${result.cwd}\` is not a git repository.`);
      break;
    case "git_error":
      addLogEntry(agentId, "system", `Failed to run git diff in \`${result.cwd}\`:\n\n\`\`\`\n${result.message}\n\`\`\``);
      break;
    case "clean":
      addLogEntry(agentId, "system", `Working tree clean in \`${result.cwd}\` — no uncommitted changes.`);
      break;
    case "ok":
      addLogEntry(agentId, "diff", result.summary, undefined, undefined, { diff: result.payload });
      break;
  }
  updateState(agentId, "waiting_for_response");
  return true;
}
