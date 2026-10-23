import { commandDescriptionMessage } from "../../../shared/i18n/command-description.ts";
import { en } from "../../../shared/i18n/en.ts";
import { logMessage, logParts, type LogMessage, type LogParam } from "../../../shared/i18n/log-message.ts";
import { commands } from "../commands.ts";

/** Match the registry text so external skills and newer descriptions stay literal. */
export function commandDescription(name: string, description: string | undefined): LogParam | undefined {
  if (!Object.hasOwn(commands, name) || commands[name].description !== description) return description;
  return commandDescriptionMessage(name, description) ?? description;
}

const customMessages = {
  compact: "logs.help.compact",
  cost: "logs.help.cost",
  logout: "logs.help.logout",
  "reload-plugins": "logs.help.reloadPlugins",
  exit: "logs.help.exit",
  plugin: "logs.help.plugins",
  loop: "logs.help.loop",
} as const;

export function unsupportedLogMessage(name: string): string | LogMessage {
  const cfg = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (cfg?.message) {
    const key = Object.hasOwn(customMessages, name) ? customMessages[name as keyof typeof customMessages] : undefined;
    return key && en[key] === cfg.message ? logMessage(key) : cfg.message;
  }
  if (!cfg) return logMessage("logs.help.unavailable", { command: name });
  const description = cfg.description ? logParts([" (", { lowercase: commandDescription(name, cfg.description)! }, ")"]) : "";
  return logMessage(cfg.type === "bundled-skill" ? "logs.help.unsupportedSkill" : "logs.help.unsupportedCommand", { command: name, description });
}
