import type { NormalizedEvent } from "../types.ts";
import { PASS, type JsonRpcId, type JsonRpcRequest } from "./client-types.ts";
import { extractApprovalInput, inferApprovalDescription, inferApprovalTitle, inferToolNameFromApproval, mapApprovalDecision } from "./approvals.ts";
import { LOGIN_INSTRUCTIONS } from "./config.ts";
import { approvalCwd, commandTokensForPrefixMatch, isExecApprovalMethod, offerablePrefix, type SessionPrefixRules } from "./prefix-rules.ts";
import { AUTO_APPROVED_BY_PREFIX_RULE, type AllowPrefixContext } from "./prefix-rule-notices.ts";

export interface PendingApproval extends AllowPrefixContext {
  jsonRpcId: JsonRpcId;
  toolName: string;
  // The server-request method that issued this approval. Different methods
  // have different response enums, so approve() uses this to pick the right
  // wire shape.
  method: string;
  resolve: (response: unknown) => void;
  reject: (err: unknown) => void;
}

export interface CodexServerRequestDeps {
  threadId: string | null;
  pendingApprovals: Map<string, PendingApproval>;
  // The session's in-memory prefix allow list. Consulted before surfacing an
  // approval so a command the user already blessed never prompts again.
  prefixRules: SessionPrefixRules;
  enqueue: (event: NormalizedEvent) => void;
}

export async function handleCodexServerRequest(req: JsonRpcRequest, deps: CodexServerRequestDeps): Promise<unknown> {
  const params = req.params as Record<string, unknown> | null | undefined;
  // Per-thread filter on server requests that target a thread.
  if (params?.threadId !== undefined && deps.threadId && params.threadId !== deps.threadId) {
    return PASS;
  }

  switch (req.method) {
    // ---- Approvals routed through orchestrator (binary allow/deny UX) ----
    // item/permissions/requestApproval has a richer response shape
    // (GrantedPermissionProfile + scope + strictAutoReview) that doesn't
    // map cleanly to our 3-option /resolve UX — auto-decline at v1.
    case "applyPatchApproval":
    case "execCommandApproval":
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval": {
      const approvalId = String(req.id);
      const toolName = inferToolNameFromApproval(req.method);
      const title = inferApprovalTitle(req.method, params);
      const description = inferApprovalDescription(req.method, params);
      const commandTokens = isExecApprovalMethod(req.method) ? commandTokensForPrefixMatch(params) : null;
      const suggestedPrefix = offerablePrefix(req.method, params, commandTokens);

      // Already covered by a prefix the user allowed earlier this session?
      // Answer codex directly and never surface a prompt. The match runs on
      // the command text codex is about to execute, NOT on the suggestion
      // attached to this request — codex's suggestion only describes the
      // FIRST segment of a chained command (measured: `mkdir -p g && whoami`
      // suggests just ["mkdir","-p","g"]), so trusting it here would let a
      // chained command ride in on a rule the user set for its harmless head.
      if (deps.prefixRules.matches(req.method, params)) {
        deps.enqueue({
          kind: "system_text",
          bureauAuthored: true,
          text: AUTO_APPROVED_BY_PREFIX_RULE,
        });
        return { decision: mapApprovalDecision(req.method, { kind: "allow_once" }) };
      }

      // The promise we return is what the JsonRpcLiteClient's handler chain
      // awaits. session.approve() resolves it with the right enum-variant
      // response shape, the client auto-responds, and the handler frame
      // frees. close() rejects any still-pending entries.
      return new Promise<unknown>((resolve, reject) => {
        deps.pendingApprovals.set(approvalId, {
          jsonRpcId: req.id,
          toolName,
          method: req.method,
          suggestedPrefix,
          commandTokens,
          cwd: approvalCwd(params),
          resolve,
          reject,
        });
        deps.enqueue({
          kind: "approval_request",
          approvalId,
          toolName,
          input: extractApprovalInput(req.method, params),
          title,
          description,
          // Both labels are built here, already safe to display: the
          // orchestrator renders them and never takes them apart again.
          ...(suggestedPrefix
            ? {
                allowPrefixLabel: suggestedPrefix.join(" "),
                ...(suggestedPrefix.length > 1 ? { allowPrefixExample: suggestedPrefix.slice(0, -1).join(" ") } : {}),
              }
            : {}),
        });
      });
    }

    // ---- Permissions request: auto-decline with JSON-RPC error ----
    case "item/permissions/requestApproval":
      deps.enqueue({
        kind: "system_text",
        text: `Auto-declined permissions request from codex (v1 doesn't expose permission-profile changes — use the spawn dialog to pick a different sandbox/approval policy).`,
      });
      throw new Error("Permissions profile changes are not supported in Bureau v1.");

    // ---- Auto-decline (correct response shapes per server schema) ----
    case "item/tool/requestUserInput":
      // ToolRequestUserInputResponse shape is { answers: HashMap<...> }, no
      // canceled/decline field. Sending a JSON-RPC error is the correct
      // way to say "the client can't answer this."
      deps.enqueue({
        kind: "system_text",
        text: `Auto-declined structured tool-input request from codex (v1 doesn't support agent-issued Q&A).`,
      });
      throw new Error("Bureau v1 does not implement item/tool/requestUserInput.");

    case "mcpServer/elicitation/request":
      // Confirmed against the schema: { action: "accept" | "decline" | "cancel" }.
      deps.enqueue({
        kind: "system_text",
        text: `Auto-declined MCP elicitation request (v1 doesn't surface MCP elicitation UX).`,
      });
      return { action: "decline" };

    case "item/tool/call":
      // DynamicToolCallResponse shape is { contentItems, success }, no
      // canceled field. We could synthesize a "tool not implemented"
      // failure response, but a JSON-RPC error is clearer for v1: the
      // agent sees the tool call failed at the protocol level rather than
      // as an opaque "tool returned this" reply.
      deps.enqueue({
        kind: "system_text",
        text: `Auto-declined dynamic tool call from codex (v1 doesn't expose dynamic tools).`,
      });
      throw new Error("Bureau v1 does not implement item/tool/call (dynamic tools).");

    // ---- Auth token refresh ----
    case "account/chatgptAuthTokens/refresh":
      // We don't have a token store; respond with an error so codex falls
      // back to user-facing login flow.
      deps.enqueue({
        kind: "error",
        message: `Codex requested a ChatGPT auth token refresh, but Bureau has no token store. ${LOGIN_INSTRUCTIONS}`,
      });
      throw new Error(`No token store: ${LOGIN_INSTRUCTIONS}`);

    // Untested at v1: attestation/generate (codex requests an attestation
    // token for upstream OpenAI calls). Falls to method-not-found via PASS
    // below. If codex hard-fails on missing attestation in some flows,
    // wire a real handler here. Subprocess-death synthesis covers the
    // worst-case (hung turn) regardless.
    default:
      // Unknown server request — let the client respond method-not-found.
      return PASS;
  }
}
