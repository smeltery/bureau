import { expect, test } from "bun:test";
import type { SlashCommandInfo } from "../../../shared/types.ts";
import { logMessage } from "../../../shared/i18n/log-message.ts";
import { buildSlashAutocomplete } from "./useSlashAutocomplete.ts";

const help: SlashCommandInfo = { name: "help", description: "List available commands", descriptionMessage: logMessage("logs.description.help") };

test("autocomplete translates only explicit command metadata, with old-client fallback", () => {
  const commands = [
    help,
    "legacy",
    { name: "custom", description: "List available commands" },
    { name: "new", description: "New words", descriptionMessage: { key: "logs.future" } } as unknown as SlashCommandInfo,
  ];
  const en = buildSlashAutocomplete({ commands, skills: [] }, "en");
  for (const language of ["es", "ca", "zh"] as const) {
    const result = buildSlashAutocomplete({ commands, skills: [] }, language);
    expect(result.allCommands).toEqual(en.allCommands);
    expect(result.commandDescriptions.get("help")).not.toBe(help.description);
    expect(result.commandDescriptions.get("custom")).toBe(help.description);
    expect(result.commandDescriptions.get("new")).toBe("New words");
    expect(result.commandDescriptions.has("legacy")).toBe(false);
  }
});

test("skill overrides keep their exact description, including absent descriptions", () => {
  for (const description of ["Custom description", help.description, undefined, ""]) {
    const result = buildSlashAutocomplete({ commands: [help], skills: [{ name: "help", origin: "user", description }] }, "es");
    expect(result.allCommands).toEqual(["help"]);
    expect(result.skillOrigins.get("help")).toBe("habilidad de usuario");
    expect(result.commandDescriptions.get("help")).toBe(description || undefined);
  }
  expect(buildSlashAutocomplete(undefined, "ca").allCommands).toEqual([]);
});
