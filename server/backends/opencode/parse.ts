// OpenCode SSE / HTTP response parsers. Keeps wire-shape validation out of
// the transport class so both stay under the file-size budget.

import type { NormalizedMessage, TokenUsage } from "../types.ts";

export interface DiscoveredOpenCodeModel {
  id: string;
  label: string;
  contextLimit?: number;
  isFree?: boolean;
}

export interface OpenCodeContextBreakdown {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface SafeOpenCodeError {
  name?: string;
  message?: string;
  statusCode?: number;
  isRetryable?: boolean;
}

export type AllowedEvent =
  | { kind: "assistant"; sessionId: string; messageId: string }
  | { kind: "text"; sessionId: string; messageId: string; partId: string; text: string }
  | { kind: "reasoning"; sessionId: string; messageId: string; partId: string; text: string; durationMs?: number }
  | {
      kind: "tool";
      sessionId: string;
      partId: string;
      callId: string;
      name: string;
      status: "pending" | "running" | "completed" | "error";
      input: Record<string, unknown>;
      output?: string;
      error?: string;
      exitCode?: number;
      durationMs?: number;
    }
  | { kind: "permission"; sessionId: string; id: string; permission: unknown; patterns: unknown }
  | { kind: "permission_fault"; sessionId: string }
  | {
      kind: "step_finish";
      sessionId: string;
      usage?: TokenUsage;
      contextBreakdown?: OpenCodeContextBreakdown;
      cost?: number;
    }
  | { kind: "idle"; sessionId: string }
  | { kind: "error"; sessionId: string; error: SafeOpenCodeError };

export function splitModel(model: string): [string, string] {
  const slash = model.indexOf("/");
  if (slash < 1 || slash === model.length - 1) {
    throw new Error("OpenCode model must use provider/model form.");
  }
  return [model.slice(0, slash), model.slice(slash + 1)];
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function stringField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === "string" ? value[key] : null;
}

export function numberField(value: Record<string, unknown>, key: string): number | null {
  return typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : null;
}

export function allowSession(raw: unknown): { id: string } {
  const id = stringField(asRecord(raw), "id");
  if (!id) throw new Error("OpenCode returned an invalid session shape.");
  return { id };
}

export function allowMessages(raw: unknown): NormalizedMessage[] {
  if (!Array.isArray(raw)) throw new Error("OpenCode returned an invalid message list.");
  return raw.map((value) => {
    const message = asRecord(value);
    const info = asRecord(message.info);
    const uuid = stringField(info, "id");
    const role = info.role;
    if (!uuid || (role !== "user" && role !== "assistant" && role !== "system" && role !== "result")) {
      throw new Error("OpenCode returned an invalid message shape.");
    }
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const text = parts
      .map(asRecord)
      .filter((part) => part.type === "text")
      .map((part) => stringField(part, "text") ?? "")
      .join("");
    return { uuid, role, text };
  });
}

export function openCodeModelIsFree(rawCost: unknown): boolean {
  const cost = asRecord(rawCost);
  const cache = asRecord(cost.cache);
  const values = [cost.input, cost.output, cache.read, cache.write].filter((v) => v !== undefined);
  return values.length > 0 && values.every((value) => typeof value === "number" && value === 0);
}

export function allowDiscoveredModels(raw: unknown): DiscoveredOpenCodeModel[] {
  const body = asRecord(raw);
  const connected = new Set(Array.isArray(body.connected) ? body.connected.filter((v): v is string => typeof v === "string") : []);
  const byId = new Map<string, DiscoveredOpenCodeModel>();
  if (!Array.isArray(body.all)) return [];
  for (const rawProvider of body.all) {
    const provider = asRecord(rawProvider);
    const providerId = stringField(provider, "id");
    if (!providerId || !safeCatalogId(providerId) || !connected.has(providerId)) continue;
    const providerLabel = safeCatalogLabel(provider.name, providerId);
    const models = asRecord(provider.models);
    for (const [rawModelId, rawModel] of Object.entries(models)) {
      const modelId = rawModelId.startsWith(`${providerId}/`) ? rawModelId.slice(providerId.length + 1) : rawModelId;
      if (!modelId || !safeCatalogId(modelId)) continue;
      const id = `${providerId}/${modelId}`;
      const model = asRecord(rawModel);
      const modelLabel = safeCatalogLabel(model.name, modelId);
      const contextLimit = numberField(asRecord(model.limit), "context");
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          label: providerId === "opencode" || providerId === "opencode-go" ? modelLabel : `${providerLabel} - ${modelLabel}`,
          ...(contextLimit !== null && contextLimit > 0 ? { contextLimit } : {}),
          ...(openCodeModelIsFree(model.cost) ? { isFree: true } : {}),
        });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function allowError(value: unknown): SafeOpenCodeError {
  const error = asRecord(value);
  const data = asRecord(error.data);
  return {
    ...(typeof error.name === "string" ? { name: error.name } : {}),
    ...(typeof data.message === "string" ? { message: data.message } : {}),
    ...(typeof data.statusCode === "number" ? { statusCode: data.statusCode } : {}),
    ...(typeof data.isRetryable === "boolean" ? { isRetryable: data.isRetryable } : {}),
  };
}

export function parseAllowedEvent(data: string): AllowedEvent | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = raw.type;
  const properties = asRecord(raw.properties);
  const sessionId = stringField(properties, "sessionID");
  if (!sessionId) return null;
  if (type === "session.idle") return { kind: "idle", sessionId };
  if (type === "session.error") return { kind: "error", sessionId, error: allowError(properties.error) };
  if (type === "permission.asked") {
    const id = stringField(properties, "id");
    if (!id) return { kind: "permission_fault", sessionId };
    return { kind: "permission", sessionId, id, permission: properties.permission, patterns: properties.patterns };
  }
  if (type === "message.updated") {
    const info = asRecord(properties.info);
    const messageId = stringField(info, "id");
    if (info.role === "assistant" && messageId) return { kind: "assistant", sessionId, messageId };
  }
  if (type === "message.part.updated") return parsePartUpdated(sessionId, asRecord(properties.part));
  return null;
}

function parsePartUpdated(sessionId: string, part: Record<string, unknown>): AllowedEvent | null {
  const messageId = stringField(part, "messageID");
  const partId = stringField(part, "id");
  const text = stringField(part, "text");
  if (part.type === "text" && messageId && partId && text !== null) {
    return { kind: "text", sessionId, messageId, partId, text };
  }
  if (part.type === "reasoning" && messageId && partId && text !== null) {
    const time = asRecord(part.time);
    const start = numberField(time, "start");
    const end = numberField(time, "end");
    return {
      kind: "reasoning",
      sessionId,
      messageId,
      partId,
      text,
      ...(start !== null && end !== null ? { durationMs: Math.max(0, end - start) } : {}),
    };
  }
  if (part.type === "tool" && partId) {
    const state = asRecord(part.state);
    const status = state.status;
    const callId = stringField(part, "callID");
    const name = stringField(part, "tool");
    if (!callId || !name || !isToolStatus(status)) return null;
    const time = asRecord(state.time);
    const metadata = asRecord(state.metadata);
    const start = numberField(time, "start");
    const end = numberField(time, "end");
    return {
      kind: "tool",
      sessionId,
      partId,
      callId,
      name,
      status,
      input: asRecord(state.input),
      ...(typeof state.output === "string" ? { output: state.output } : {}),
      ...(typeof state.error === "string" ? { error: state.error } : {}),
      ...(numberField(metadata, "exit") !== null ? { exitCode: numberField(metadata, "exit")! } : {}),
      ...(start !== null && end !== null ? { durationMs: Math.max(0, end - start) } : {}),
    };
  }
  if (part.type === "step-finish") {
    const tokens = asRecord(part.tokens);
    const cache = asRecord(tokens.cache);
    const input = numberField(tokens, "input");
    const output = numberField(tokens, "output");
    const reasoning = numberField(tokens, "reasoning");
    const total = numberField(tokens, "total");
    if (!partId) return null;
    const usage =
      input !== null && output !== null
        ? {
            inputTokens: input,
            outputTokens: output,
            cacheReadInputTokens: numberField(cache, "read") ?? 0,
            cacheCreationInputTokens: numberField(cache, "write") ?? 0,
          }
        : undefined;
    const cost = numberField(part, "cost");
    const contextBreakdown =
      total !== null && total >= 0 && input !== null && output !== null && reasoning !== null
        ? {
            totalTokens: total,
            inputTokens: input,
            outputTokens: output,
            reasoningTokens: reasoning,
            cacheReadInputTokens: numberField(cache, "read") ?? 0,
            cacheCreationInputTokens: numberField(cache, "write") ?? 0,
          }
        : undefined;
    return {
      kind: "step_finish",
      sessionId,
      ...(usage ? { usage } : {}),
      ...(contextBreakdown ? { contextBreakdown } : {}),
      ...(cost !== null ? { cost } : {}),
    };
  }
  return null;
}

function safeCatalogId(value: string): boolean {
  return value.length <= 128 && /^[a-zA-Z0-9._:-]+$/.test(value);
}

function safeCatalogLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return fallback;
  if ([...value].some((c) => c.charCodeAt(0) <= 31 || c.charCodeAt(0) === 127)) return fallback;
  if (/(authorization|api[-_ ]?key|access[-_ ]?token|password|secret|bearer)/i.test(value)) return fallback;
  return value;
}

function isToolStatus(value: unknown): value is "pending" | "running" | "completed" | "error" {
  return value === "pending" || value === "running" || value === "completed" || value === "error";
}
