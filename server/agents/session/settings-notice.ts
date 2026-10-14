import { effortDisplayLabel, familyDisplayLabel, type AgentInfo } from "../../../shared/types.ts";
import type { ManagedAgent } from "../state-types.ts";

const fields = ["modelFamily", "effort", "permissionMode", "codexSandbox", "cwd"] as const;
type Field = (typeof fields)[number];
export interface SettingsNotice {
  changes: Partial<Record<Field, { from: string; to: string }>>;
  actors: string[];
  interrupted: boolean;
}

/** Retain the original value across edits until a turn accepts the notice. */
export function armSettingsNotice(managed: ManagedAgent, before: AgentInfo, actor: string, interrupted: boolean): void {
  const previous = managed.settingsNotice;
  const changes = { ...previous?.changes };
  for (const field of fields) {
    const from = String(before[field] ?? "default");
    const to = String(managed.info[field] ?? "default");
    if (from === to) continue;
    const original = changes[field]?.from ?? from;
    if (original === to) delete changes[field];
    else changes[field] = { from: original, to };
  }
  const stopped = interrupted || previous?.interrupted === true;
  managed.settingsNotice = Object.keys(changes).length || stopped ? { changes, actors: [...new Set([...(previous?.actors ?? []), actor])], interrupted: stopped } : null;
}

export function renderSettingsNotice(notice: SettingsNotice, info: AgentInfo): string {
  const labels: Record<Field, string> = { modelFamily: "Model", effort: "Thinking effort", permissionMode: "Permission mode", codexSandbox: "Sandbox", cwd: "Working directory" };
  const value = (field: Field, raw: string) =>
    field === "modelFamily" ? familyDisplayLabel(raw, info.claudeModelOverrides) : field === "effort" ? effortDisplayLabel(raw as AgentInfo["effort"]) : raw;
  const lines = [`Agent settings changed by ${notice.actors.join(", ")}. These settings now apply to this conversation.`];
  for (const field of fields) {
    const change = notice.changes[field];
    if (change) lines.push(`${labels[field]}: ${value(field, change.from)} → ${value(field, change.to)}.`);
  }
  if (notice.interrupted) lines.push("The restart interrupted the previous turn. Commands may have partially run; verify their effects before retrying.");
  return lines.join("\n");
}
