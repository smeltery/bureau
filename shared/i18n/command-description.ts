import { commandDescriptions } from "./command-descriptions-en.ts";
import { logMessage, type LogMessage } from "./log-message.ts";

/** Only attach to registry-owned commands, never discovered skill descriptions. */
export function commandDescriptionMessage(name: string, description: string | undefined): LogMessage | undefined {
  const key = `logs.description.${name.replace(/[-_]([a-z])/g, (_, letter: string) => letter.toUpperCase())}` as keyof typeof commandDescriptions;
  if (!Object.hasOwn(commandDescriptions, key) || commandDescriptions[key] !== description) return;
  return logMessage(key);
}
