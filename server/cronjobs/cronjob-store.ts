import { type Cronjob, type CronjobRun, type LogEntry } from "../../shared/types.ts";
import { saveCronjobsPrompt } from "../persistence.ts";
import { addCronjobDefinition, deleteCronjobDefinition, updateCronjobDefinition, type AddCronjobInput, type UpdateCronjobChanges } from "./definitions.ts";

export type CronjobEvent =
  | { type: "cronjob_added"; cronjob: Cronjob }
  | { type: "cronjob_updated"; cronjob: Cronjob }
  | { type: "cronjob_deleted"; id: string }
  | { type: "cronjobs_prompt_updated"; value: string | null }
  | { type: "cronjob_run_updated"; run: CronjobRun }
  | { type: "log_entry"; entry: LogEntry }
  | { type: "clear_logs"; agentId: string };

let cronjobs: Cronjob[] = [];
let cronjobsPrompt: string | null = null;
let eventHandler: (e: CronjobEvent) => void = () => {};

export type { AddCronjobInput, UpdateCronjobChanges };

export function onCronjobEvent(handler: (e: CronjobEvent) => void) {
  eventHandler = handler;
}

export function emitCronjobEvent(event: CronjobEvent) {
  eventHandler(event);
}

export function getCronjobDefinitions(): Cronjob[] {
  return cronjobs;
}

export function setCronjobDefinitions(next: Cronjob[]) {
  cronjobs = next;
}

export function listCronjobs(): Cronjob[] {
  return cronjobs;
}

export function findCronjob(id: string): Cronjob | undefined {
  return cronjobs.find((c) => c.id === id);
}

export function getCronjobsPrompt(): string | null {
  return cronjobsPrompt;
}

export function setLoadedCronjobsPrompt(value: string | null) {
  cronjobsPrompt = value;
}

export function setCronjobsPrompt(value: string | null) {
  const normalized = value && value.trim() ? value.trim() : null;
  cronjobsPrompt = normalized;
  saveCronjobsPrompt(normalized);
  emitCronjobEvent({ type: "cronjobs_prompt_updated", value: normalized });
}

export function addCronjob(input: AddCronjobInput): Cronjob {
  const cronjob = addCronjobDefinition(cronjobs, input);
  emitCronjobEvent({ type: "cronjob_added", cronjob });
  return cronjob;
}

export function updateCronjob(id: string, changes: UpdateCronjobChanges): Cronjob | null {
  const next = updateCronjobDefinition(cronjobs, id, changes);
  if (!next) return null;
  emitCronjobEvent({ type: "cronjob_updated", cronjob: next });
  return next;
}

export function deleteCronjob(id: string): boolean {
  if (!deleteCronjobDefinition(cronjobs, id)) return false;
  emitCronjobEvent({ type: "cronjob_deleted", id });
  return true;
}
