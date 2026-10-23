import { useI18n } from "../../i18n.tsx";
import { displayLogText } from "../../../shared/i18n/log-message.ts";
import { translatorFor } from "../../../shared/i18n/translate.ts";
import type { SupportedLanguageCode } from "../../../shared/languages.ts";
import { useEffect, useMemo, useState } from "react";
import type { SkillInfo, SlashCommandInfo } from "../../../shared/types.ts";

type AgentCmds =
  | {
      commands: (SlashCommandInfo | string)[];
      skills: SkillInfo[];
    }
  | undefined;

/**
 * Merges agent hardcoded commands + discovered skills into one sorted list,
 * computes origin labels and descriptions, and filters based on current
 * input starting with `/`.
 *
 * Returns everything the dropdown needs plus the input-state predicates
 * so callers can decide when to show it.
 */
export function buildSlashAutocomplete(agentCmds: AgentCmds, language: SupportedLanguageCode) {
  const { t } = translatorFor(language);
  const cmds: string[] = [];
  const origins = new Map<string, string>(); // name → origin label
  const descs = new Map<string, string>(); // name → description
  const originLabels: Record<string, string> = {
    user: t("skills.originUser"),
    project: t("skills.originProject"),
    plugin: t("skills.originPlugin"),
    bureau: t("skills.originBureau"),
    claude: t("skills.originClaude"),
  };
  if (agentCmds) {
    for (const c of agentCmds.commands) {
      // Handle both old string format and new { name, description } format
      const name = typeof c === "string" ? c : c.name;
      const desc = typeof c === "string" ? undefined : c.description;
      cmds.push(name);
      if (desc) descs.set(name, typeof c === "string" ? desc : displayLogText(desc, c.descriptionMessage, language));
    }
    for (const s of agentCmds.skills) {
      if (!cmds.includes(s.name)) cmds.push(s.name);
      origins.set(s.name, originLabels[s.origin] ?? t("skills.originUnknown"));
      if (s.description) descs.set(s.name, s.description);
      else descs.delete(s.name);
    }
  }
  return { allCommands: cmds.sort(), skillOrigins: origins, commandDescriptions: descs };
}

export function useSlashAutocomplete(input: string, agentCmds: AgentCmds) {
  const { language } = useI18n();
  const { allCommands, skillOrigins, commandDescriptions } = useMemo(() => buildSlashAutocomplete(agentCmds, language), [agentCmds, language]);

  const tokenEnd = input.search(/\s/);
  const leadingToken = tokenEnd < 0 ? input : input.slice(0, tokenEnd);
  const showAutocomplete = leadingToken.startsWith("/") && leadingToken.length > 0;
  const partial = leadingToken.slice(1).toLowerCase();
  const filteredCommands = useMemo(() => {
    if (!showAutocomplete) return [];
    if (partial === "") return allCommands;
    return allCommands.filter((c) => c.toLowerCase().startsWith(partial));
  }, [showAutocomplete, partial, allCommands]);

  const [selectedIdx, setSelectedIdx] = useState(0);
  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIdx(0);
  }, [filteredCommands.length, partial]);

  return {
    showAutocomplete,
    partial,
    allCommands,
    filteredCommands,
    skillOrigins,
    commandDescriptions,
    selectedIdx,
    setSelectedIdx,
  };
}
