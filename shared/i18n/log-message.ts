import type { LogEntry } from "../log-types.ts";
import type { SupportedLanguageCode } from "../languages.ts";
import { en } from "./en.ts";
import { CATALOGS, interpolate, type EnglishText, type Params, type Placeholders } from "./translate.ts";
import type { logs } from "./logs-en.ts";

export type LogMessageKey = keyof typeof logs;
export type LogParam = string | number | LogMessage | { timestamp: number };
export interface LogMessage {
  key: LogMessageKey;
  params?: Record<string, LogParam>;
}

type LogParamsFor<K extends LogMessageKey> = [Placeholders<EnglishText<K>>] extends [never] ? [] : [Record<Placeholders<EnglishText<K>>, LogParam>];

/** Only Bureau-authored messages opt into translation; never infer from text. */
export function logMessage<K extends LogMessageKey>(key: K, ...params: LogParamsFor<K>): LogMessage {
  return { key, ...(params.length ? { params: params[0] } : {}) };
}

function renderParam(value: unknown, language: SupportedLanguageCode, depth: number): string | number | undefined {
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (Object.hasOwn(value, "timestamp")) {
    const timestamp = (value as { timestamp: unknown }).timestamp;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) return;
    return new Intl.DateTimeFormat(language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
  }
  return renderMessage(value, language, depth + 1);
}

/** Validate wire/disk data and bound recursive parameters, including cycles. */
function renderMessage(value: unknown, language: SupportedLanguageCode, depth = 0): string | undefined {
  if (depth > 8 || !value || typeof value !== "object" || Array.isArray(value)) return;
  const { key, params } = value as Record<string, unknown>;
  if (!Object.hasOwn(value, "key") || typeof key !== "string" || !key.startsWith("logs.") || !Object.hasOwn(en, key)) return;
  if (params !== undefined && (!params || typeof params !== "object" || Array.isArray(params))) return;
  const values = params as Record<string, unknown> | undefined;
  const rendered: Params = Object.create(null);
  for (const [name, param] of Object.entries(values ?? {})) {
    const text = renderParam(param, language, depth);
    if (text === undefined) return;
    rendered[name] = text;
  }
  const template = en[key as LogMessageKey];
  for (const [, name] of template.matchAll(/\{(\w+)\}/g)) {
    if (!Object.hasOwn(rendered, name)) return;
  }
  return interpolate(CATALOGS[language]?.[key as LogMessageKey] ?? template, rendered);
}

/** English content is retained for APIs, search, agents, and older clients. */
export function logContent(content: string | LogMessage): Pick<LogEntry, "content" | "message"> {
  if (typeof content === "string") return { content };
  const rendered = renderMessage(content, "en");
  if (rendered === undefined) throw new Error("Invalid structured log message");
  return { content: rendered, message: content };
}

export function displayLogText(content: string, message: unknown, language: SupportedLanguageCode): string {
  return renderMessage(message, language) ?? content;
}

export function displayLogContent(entry: Pick<LogEntry, "kind" | "content" | "message">, language: SupportedLanguageCode): string {
  if (entry.kind !== "system" && entry.kind !== "error") return entry.content;
  return displayLogText(entry.content, entry.message, language);
}
