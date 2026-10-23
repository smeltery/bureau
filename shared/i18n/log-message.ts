import type { LogEntry } from "../log-types.ts";
import type { SupportedLanguageCode } from "../languages.ts";
import { en } from "./en.ts";
import { CATALOGS, interpolate, type Params, type ParamsFor } from "./translate.ts";
import type { logs } from "./logs-en.ts";

export type LogMessageKey = keyof typeof logs;
export interface LogMessage {
  key: LogMessageKey;
  params?: Params;
}

/** Only Bureau-authored messages opt into translation; never infer from text. */
export function logMessage<K extends LogMessageKey>(key: K, ...params: ParamsFor<K>): LogMessage {
  return { key, ...(params.length ? { params: params[0] } : {}) };
}

/** Persisted/wire payloads may come from older or newer servers. */
function validatedMessage(value: unknown): LogMessage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const { key, params } = value as Record<string, unknown>;
  if (typeof key !== "string" || !key.startsWith("logs.") || !Object.hasOwn(en, key)) return;
  if (params !== undefined && (!params || typeof params !== "object" || Array.isArray(params))) return;
  const values = params as Record<string, unknown> | undefined;
  if (values && Object.values(values).some((param) => typeof param !== "string" && (typeof param !== "number" || !Number.isFinite(param)))) return;
  const template = en[key as LogMessageKey];
  for (const [, name] of template.matchAll(/\{(\w+)\}/g)) {
    if (!values || !Object.hasOwn(values, name)) return;
  }
  return { key: key as LogMessageKey, params: values as Params | undefined };
}

/** English content is retained for APIs, search, agents, and older clients. */
export function logContent(content: string | LogMessage): Pick<LogEntry, "content" | "message"> {
  if (typeof content === "string") return { content };
  const message = validatedMessage(content);
  if (!message) throw new Error("Invalid structured log message");
  return { content: interpolate(en[message.key], message.params), message };
}

export function displayLogContent(entry: Pick<LogEntry, "kind" | "content" | "message">, language: SupportedLanguageCode): string {
  if (entry.kind !== "system" && entry.kind !== "error") return entry.content;
  const message = validatedMessage(entry.message);
  if (!message) return entry.content;
  return interpolate(CATALOGS[language]?.[message.key] ?? en[message.key], message.params);
}
