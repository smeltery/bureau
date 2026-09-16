import type { ServerWebSocket } from "bun";
import type { ClientCommand } from "../../shared/types.ts";
import { handleAccessCommand } from "./access-commands.ts";
import { handleAgentCommand } from "./agent-commands.ts";
import { handleBrowserCommand } from "./browser-commands.ts";
import { handleCronjobCommand } from "./cronjob-commands.ts";
import { handleSettingsCommand } from "./settings-commands.ts";
import { handleTaskCommand } from "./task-commands.ts";
import { canUseRoom, handleUserCommand } from "./user-commands.ts";

export async function handleCommand(cmd: ClientCommand, ws: ServerWebSocket<unknown>) {
  if (cmd.type === "browser_watch" || cmd.type === "browser_input") {
    await handleBrowserCommand(cmd, ws);
    return;
  }
  if (await handleAccessCommand(cmd, ws)) return;
  if (handleTaskCommand(cmd)) return;
  if (await handleUserCommand(cmd, ws)) return;
  if (handleCronjobCommand(cmd, ws)) return;
  if (handleSettingsCommand(cmd, ws, (roomId) => canUseRoom(ws, roomId))) return;
  await handleAgentCommand(cmd, ws);
}
