// Lookup over the catalogs in this directory: no library, a typed catalog per
// language, `{name}` interpolation, and explicit one/other plural pairs picked
// with Intl.PluralRules. Pure and React-free so ui/ and tests can share it.

import { DEFAULT_LANGUAGE, type SupportedLanguageCode } from "../languages.ts";
import { en, type Catalog, type MessageKey } from "./en.ts";
import { es } from "./es.ts";
import { ca } from "./ca.ts";

export type { Catalog, MessageKey };

export const CATALOGS: Record<SupportedLanguageCode, Catalog> = { en, es, ca };

/** Values for the `{name}` placeholders of one message. */
export type Params = Record<string, string | number>;

/** A catalog as the engine sees it: keys to strings, nothing typed. */
export type Messages = Readonly<Record<string, string | undefined>>;

// "{name} owes {count}" -> "name" | "count". Derived from the English text.
export type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never;

export type EnglishText<K extends MessageKey> = (typeof en)[K];

export type PlainMessageKey = {
  [K in MessageKey]: [Placeholders<EnglishText<K>>] extends [never] ? K : never;
}[MessageKey];

export type ParamsFor<K extends MessageKey> = [Placeholders<EnglishText<K>>] extends [never] ? [] : [Record<Placeholders<EnglishText<K>>, string | number>];

export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.one` ? (`${Base}.other` extends MessageKey ? Base : never) : never;
}[MessageKey];

type PluralPlaceholders<K extends PluralKey> = Exclude<Placeholders<EnglishText<`${K}.other` & MessageKey>>, "count">;

export type PluralParamsFor<K extends PluralKey> = [PluralPlaceholders<K>] extends [never] ? [] : [Record<PluralPlaceholders<K>, string | number>];

export interface Translator {
  language: SupportedLanguageCode;
  t: <K extends MessageKey>(key: K, ...params: ParamsFor<K>) => string;
  tn: <K extends PluralKey>(key: K, count: number, ...params: PluralParamsFor<K>) => string;
}

const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function lookupIn(catalog: Messages, fallback: Messages, key: string, params?: Params): string {
  return interpolate(catalog[key] ?? fallback[key] ?? key, params);
}

export function pluralIn(catalog: Messages, fallback: Messages, rules: Intl.PluralRules, key: string, count: number, params?: Params): string {
  const exact = `${key}.${rules.select(count)}`;
  const chosen = catalog[exact] !== undefined || fallback[exact] !== undefined ? exact : `${key}.other`;
  return lookupIn(catalog, fallback, chosen, { ...params, count });
}

export function keyFrom<K extends MessageKey>(table: Readonly<Record<string, K>>, id: string): K | undefined {
  return Object.hasOwn(table, id) ? table[id] : undefined;
}

const translators = new Map<SupportedLanguageCode, Translator>();

export function translatorFor(language: SupportedLanguageCode): Translator {
  const cached = translators.get(language);
  if (cached) return cached;
  const catalog = CATALOGS[language];
  const fallback = CATALOGS[DEFAULT_LANGUAGE];
  const rules = new Intl.PluralRules(language);
  const translator: Translator = {
    language,
    t: (key, ...rest) => lookupIn(catalog, fallback, key, (rest as [Params?])[0]),
    tn: (key, count, ...rest) => pluralIn(catalog, fallback, rules, key, count, (rest as [Params?])[0]),
  };
  translators.set(language, translator);
  return translator;
}
