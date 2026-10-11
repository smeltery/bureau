export interface AuditEntry {
  id: string;
  at: number;
  actor: string;
  operation: string;
  target: string;
  fields: string[];
  outcome: "pending" | "committed" | "failed";
}
export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}
