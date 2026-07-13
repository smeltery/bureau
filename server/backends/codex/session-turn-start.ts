import { errMessage } from "../../../shared/errors.ts";

import type { JsonRpcLiteClient } from "./client.ts";
import { AUTH_ERROR_PATTERNS } from "./config.ts";
import type { CodexAuthSignalGate } from "./session-auth-gate.ts";

export async function startCodexTurn(opts: {
  client: JsonRpcLiteClient;
  threadId: string;
  input: unknown;
  authGate: CodexAuthSignalGate;
  enqueueAuthAwareSystemText: (text: string) => void;
}): Promise<void> {
  const { client, threadId, input, authGate, enqueueAuthAwareSystemText } = opts;

  // Keep the auth-stderr gate open during turn/start's await window because
  // codex websocket retries can land on stderr before the RPC returns.
  authGate.openTurn();
  try {
    await client.request("turn/start", { threadId, input });
  } catch (err) {
    const message = errMessage(err);
    if (AUTH_ERROR_PATTERNS.test(message)) {
      enqueueAuthAwareSystemText(`Codex auth error during turn start: ${message}`);
    }
    authGate.resetTurn();
    throw err;
  }
}
