import type { LogEntry } from "../log-types.ts";
import type { SupportedLanguageCode } from "../languages.ts";
import { en } from "./en.ts";
import { CATALOGS, interpolate, type EnglishText, type Params, type Placeholders } from "./translate.ts";
import type { logs } from "./logs-en.ts";

export type LogMessageKey = keyof typeof logs;
export type LogPluralKey = {
  [K in LogMessageKey]: K extends `${infer Base}.one` ? (`${Base}.other` extends LogMessageKey ? Base : never) : never;
}[LogMessageKey];
export type LogParam = string | number | LogMessage | { timestamp: number } | { parts: LogParam[] } | { lowercase: LogParam };
export interface LogMessage {
  key: LogMessageKey | LogPluralKey;
  count?: number;
  params?: Record<string, LogParam>;
}

type LogParamsFor<K extends LogMessageKey> = [Placeholders<EnglishText<K>>] extends [never] ? [] : [Record<Placeholders<EnglishText<K>>, LogParam>];

/** Only Bureau-authored messages opt into translation; never infer from text. */
export function logMessage<K extends LogMessageKey>(key: K, ...params: LogParamsFor<K>): LogMessage {
  return { key, ...(params.length ? { params: params[0] } : {}) };
}

type CountParams<K extends LogPluralKey> = Exclude<Placeholders<EnglishText<`${K}.other` & LogMessageKey>>, "count">;

export function logPlural<K extends LogPluralKey>(key: K, count: number, ...params: [CountParams<K>] extends [never] ? [] : [Record<CountParams<K>, LogParam>]): LogMessage {
  return { key, count, ...(params.length ? { params: params[0] } : {}) };
}

export function logParts(parts: LogParam[]): LogMessage {
  return logMessage("logs.parts", { parts: { parts } });
}

function renderParam(value: unknown, language: SupportedLanguageCode, depth: number): string | number | undefined {
  if (depth > 8) return;
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (Object.hasOwn(value, "lowercase")) {
    const text = renderParam((value as { lowercase: unknown }).lowercase, language, depth + 1);
    return text === undefined ? undefined : String(text).toLocaleLowerCase(language);
  }
  if (Object.hasOwn(value, "parts")) {
    const parts = (value as { parts: unknown }).parts;
    if (!Array.isArray(parts)) return;
    const texts = parts.map((part) => renderParam(part, language, depth + 1));
    if (texts.some((text) => text === undefined)) return;
    return texts.join("");
  }
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
  const { key, params, count } = value as Record<string, unknown>;
  if (!Object.hasOwn(value, "key") || typeof key !== "string" || !key.startsWith("logs.")) return;
  let selected = key;
  if (count !== undefined) {
    if (typeof count !== "number" || !Number.isFinite(count) || !Object.hasOwn(en, `${key}.one`) || !Object.hasOwn(en, `${key}.other`)) return;
    const category = new Intl.PluralRules(language).select(count);
    selected = `${key}.${category === "one" ? "one" : "other"}`;
  }
  if (!Object.hasOwn(en, selected)) return;
  if (params !== undefined && (!params || typeof params !== "object" || Array.isArray(params))) return;
  const values = params as Record<string, unknown> | undefined;
  const rendered: Params = Object.create(null);
  for (const [name, param] of Object.entries(values ?? {})) {
    const text = renderParam(param, language, depth);
    if (text === undefined) return;
    rendered[name] = text;
  }
  if (count !== undefined) rendered.count = count as number;
  const template = en[selected as LogMessageKey];
  for (const [, name] of template.matchAll(/\{(\w+)\}/g)) {
    if (!Object.hasOwn(rendered, name)) return;
  }
  return interpolate(CATALOGS[language]?.[selected as LogMessageKey] ?? template, rendered);
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
