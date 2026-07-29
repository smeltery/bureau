import { appendLog, loadLogWithAncestors } from "../../persistence.ts";
import { autocompleteCommands } from "../commands.ts";
import { addLogEntry, emit, logCache, persistAll, type ManagedAgent } from "../state.ts";
import { deduplicateSkills, discoverBundledSkills, discoverPluginSkills, discoverProjectSkills, discoverUserSkills } from "../skills-discovery.ts";

export function handleInitMessage(agentId: string, managed: ManagedAgent | undefined, sessionId: string | undefined, sdkCommands: string[]) {
  if (managed && sessionId) {
    const hadPreviousSession = !!managed.sessionId;
    // Load prior log history if this session was seen before (walks fork ancestry)
    if (!managed.sessionId) {
      const history = loadLogWithAncestors(agentId, sessionId);
      if (history.length > 0) {
        for (const entry of history) {
          emit({ type: "log_entry", entry });
        }
      }
    }
    // If we already had a session and got a new init, this is a /clear
    if (hadPreviousSession && sessionId !== managed.sessionId) {
      logCache.set(agentId, []);
      emit({ type: "clear_logs", agentId });
      addLogEntry(agentId, "system", "Conversation cleared.");
    }
    managed.sessionId = sessionId;
    // Backfill: write any cached log entries that were created before sessionId was known
    if (!hadPreviousSession) {
      const cached = logCache.get(agentId) ?? [];
      for (const entry of cached) {
        appendLog(agentId, sessionId, entry);
      }
    }
    persistAll();
  }

  // Filter out MCP internal command names (mcp__...) — they clutter autocomplete
  const filteredSdkCommands = sdkCommands.filter((c) => !c.startsWith("mcp__"));
  // Store SDK-reported commands for pass-through resolution (step 4)
  if (managed) {
    managed.sdkReportedCommands = filteredSdkCommands;
  }

  // Autocomplete: config entries with autocomplete:true + all discovered skills
  // SDK-reported commands are NOT added to autocomplete (per design)
  // Skills are listed in priority order; deduplicate by name (highest priority wins)
  const discoveredSkills = managed ? [...discoverUserSkills(), ...discoverProjectSkills(managed.info.cwd), ...discoverPluginSkills(), ...discoverBundledSkills()] : [];
  const uniqueSkills = deduplicateSkills(discoveredSkills);
  const configCommands = autocompleteCommands();
  if (managed) {
    managed.slashCommands = configCommands;
    managed.skills = uniqueSkills;
  }
  emit({
    type: "slash_commands",
    agentId,
    commands: configCommands,
    skills: uniqueSkills,
  });
}
