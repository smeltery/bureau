import { withAuditContext } from "../audit/context.ts";
import { getWsUser } from "../users.ts";
import type { ServerWebSocket } from "bun";
import type { ClientCommand } from "../../shared/types.ts";

export type CommandDispatch = (cmd: ClientCommand, ws: ServerWebSocket<unknown>) => Promise<void> | void;

export async function dispatchBrowserCommand(ws: ServerWebSocket<unknown>, data: string | Buffer, dispatch: CommandDispatch): Promise<void> {
  try {
    const cmd = JSON.parse(data as string) as ClientCommand;
    const user = getWsUser(ws);
    await withAuditContext({ actor: user ? `member:${user.id} (${user.name})` : "local", operation: `WS ${cmd.type}` }, () => dispatch(cmd, ws));
  } catch (e) {
    console.error("Invalid command:", e);
  }
}
