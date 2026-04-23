import { useEffect, useMemo, useState } from "react";
import type { SkillInfo } from "../../../shared/types.ts";

type AgentCmds = {
  commands: ({ name: string; description?: string } | string)[];
  skills: SkillInfo[];
} | undefined;

/**
 * Merges agent hardcoded commands + discovered skills into one sorted list,
 * computes origin labels and descriptions, and filters based on current
 * input starting with `/`.
 *
 * Returns everything the dropdown needs plus the input-state predicates
 * so callers can decide when to show it.
 */
export function useSlashAutocomplete(input: string, agentCmds: AgentCmds) {
  const { allCommands, skillOrigins, commandDescriptions } = useMemo(() => {
    const cmds: string[] = [];
    const origins = new Map<string, string>(); // name → origin label
    const descs = new Map<string, string>(); // name → description
    const originLabels: Record<string, string> = {
      user: "user skill",
      project: "project skill",
      plugin: "plugin skill",
      bureau: "bureau-bundled skill",
      claude: "claude skill",
    };
    if (agentCmds) {
      for (const c of agentCmds.commands) {
        // Handle both old string format and new { name, description } format
        const name = typeof c === "string" ? c : c.name;
        const desc = typeof c === "string" ? undefined : c.description;
        cmds.push(name);
        if (desc) descs.set(name, desc);
      }
      for (const s of agentCmds.skills) {
        if (!cmds.includes(s.name)) cmds.push(s.name);
        origins.set(s.name, originLabels[s.origin] ?? "skill");
        if (s.description) descs.set(s.name, s.description);
      }
    }
    return { allCommands: cmds.sort(), skillOrigins: origins, commandDescriptions: descs };
  }, [agentCmds]);

  const showAutocomplete = input.startsWith("/") && !input.includes(" ") && input.length > 0;
  const partial = input.slice(1).toLowerCase();
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
