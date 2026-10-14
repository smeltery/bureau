export interface PromptSnapshot {
  scope: "office" | "room" | "agent" | "member";
  id: string;
  text: string;
}
export interface AuditEntry {
  id: string;
  at: number;
  actor: string;
  operation: string;
  target: string;
  fields: string[];
  prompts?: PromptSnapshot[];
  outcome: "pending" | "committed" | "failed";
}
export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}
