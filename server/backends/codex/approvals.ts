import type { ApprovalDecision } from "../types.ts";

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === "string") return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "object") return Object.keys(value).length > 0;
      return true;
    }),
  );
}

export function mapApprovalDecision(method: string, decision: ApprovalDecision): string {
  if (method === "applyPatchApproval" || method === "execCommandApproval") {
    switch (decision.kind) {
      case "allow_persistent":
        return "approved_for_session";
      case "allow_once":
        return "approved";
      case "deny":
        return "denied";
    }
  }
  switch (decision.kind) {
    case "allow_persistent":
      return "acceptForSession";
    case "allow_once":
      return "accept";
    case "deny":
      return "decline";
  }
}

export function inferToolNameFromApproval(method: string): string {
  switch (method) {
    case "applyPatchApproval":
    case "item/fileChange/requestApproval":
      return "Edit";
    case "execCommandApproval":
    case "item/commandExecution/requestApproval":
      return "Bash";
    case "item/permissions/requestApproval":
      return "Permissions";
    default:
      return method;
  }
}

export function inferApprovalTitle(method: string, rawParams: unknown): string {
  const params = rawParams as
    | {
        command?: string | string[];
        commandActions?: { command?: string }[];
      }
    | null
    | undefined;
  switch (method) {
    case "applyPatchApproval":
    case "item/fileChange/requestApproval":
      return `Codex wants to apply a patch`;
    case "execCommandApproval":
    case "item/commandExecution/requestApproval": {
      const rawCommand = params?.command;
      const cmd = Array.isArray(rawCommand) ? rawCommand.join(" ") : (rawCommand ?? params?.commandActions?.[0]?.command ?? "");
      return cmd ? `Codex wants to run: \`${cmd.slice(0, 80)}\`` : `Codex wants to run a command`;
    }
    case "item/permissions/requestApproval":
      return `Codex wants to change permissions`;
    default:
      return `Codex wants approval`;
  }
}

export function inferApprovalDescription(_method: string, params: unknown): string | undefined {
  const reason = (params as { reason?: unknown } | null | undefined)?.reason;
  if (typeof reason === "string" && reason.trim()) return reason;
  return undefined;
}

export function extractApprovalInput(method: string, params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;

  if (method === "execCommandApproval" || method === "item/commandExecution/requestApproval") {
    const command = Array.isArray(p.command) ? p.command.filter((part): part is string => typeof part === "string") : p.command;
    return compactRecord({
      command: Array.isArray(command) ? command.join(" ") : command,
      cwd: p.cwd,
      reason: p.reason,
      networkApprovalContext: p.networkApprovalContext,
      additionalPermissions: p.additionalPermissions,
    });
  }

  if (method === "applyPatchApproval") {
    return compactRecord({
      fileChanges: p.fileChanges,
      grantRoot: p.grantRoot,
      reason: p.reason,
    });
  }

  if (method === "item/fileChange/requestApproval") {
    return compactRecord({
      itemId: p.itemId,
      grantRoot: p.grantRoot,
      reason: p.reason,
    });
  }

  return {};
}
