// Office UI language context. The language is the signed-in user's saved
// preference, else a supported browser language, else English — same answer
// displayLanguage gives. Components call `const { t, tn, rich } = useI18n()`.

import { createContext, createElement, Fragment, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LANGUAGE, displayLanguage, type SupportedLanguageCode } from "../shared/languages.ts";
import { CATALOGS, lookupIn, translatorFor, type EnglishText, type MessageKey, type Placeholders, type Translator } from "../shared/i18n/translate.ts";
import { useAppState } from "./store.tsx";

type Tags<S extends string> = S extends `${string}<${infer T}>${infer Rest}` ? (T extends `/${string}` ? never : T) | Tags<Rest> : never;

export type Wrap = (chunk: ReactNode) => ReactNode;

export type RichPartsFor<K extends MessageKey> = [Placeholders<EnglishText<K>> | Tags<EnglishText<K>>] extends [never]
  ? []
  : [Record<Placeholders<EnglishText<K>>, ReactNode> & Record<Tags<EnglishText<K>>, Wrap>];

export interface UiTranslator extends Translator {
  rich: <K extends MessageKey>(key: K, ...parts: RichPartsFor<K>) => ReactNode;
}

type RichParts = Record<string, ReactNode | Wrap>;

const RICH_TOKEN = /<(\w+)>([\s\S]*?)<\/\1>|\{(\w+)\}/g;

function fillPlaceholders(text: string, parts: RichParts): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const value = parts[m[1]];
    out.push(typeof value === "function" || value === undefined ? m[0] : value);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function keyed(nodes: ReactNode[]): ReactNode {
  return createElement(Fragment, null, ...nodes.map((node, i) => createElement(Fragment, { key: i }, node)));
}

export function renderRich(template: string, parts: RichParts): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of template.matchAll(RICH_TOKEN)) {
    if (m.index! > last) out.push(template.slice(last, m.index));
    if (m[1] !== undefined) {
      const wrap = parts[m[1]];
      const inner = keyed(fillPlaceholders(m[2], parts));
      out.push(typeof wrap === "function" ? wrap(inner) : inner);
    } else {
      out.push(...fillPlaceholders(m[0], parts));
    }
    last = m.index! + m[0].length;
  }
  if (last < template.length) out.push(template.slice(last));
  return keyed(out);
}

const uiTranslators = new Map<SupportedLanguageCode, UiTranslator>();

export function uiTranslatorFor(language: SupportedLanguageCode): UiTranslator {
  const cached = uiTranslators.get(language);
  if (cached) return cached;
  const catalog = CATALOGS[language];
  const fallback = CATALOGS[DEFAULT_LANGUAGE];
  const translator: UiTranslator = {
    ...translatorFor(language),
    rich: (key, ...rest) => renderRich(lookupIn(catalog, fallback, key), (rest as [RichParts?])[0] ?? {}),
  };
  uiTranslators.set(language, translator);
  return translator;
}

const I18nCtx = createContext<UiTranslator>(uiTranslatorFor(DEFAULT_LANGUAGE));

function useSelfLanguageRecord(): { language: SupportedLanguageCode | null } | null {
  const { sessionContext, users } = useAppState();
  return useMemo(() => {
    if (!sessionContext) return null;
    const self = users.get(sessionContext.username.trim().toLocaleLowerCase());
    return self ? { language: self.language } : null;
  }, [sessionContext, users]);
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const self = useSelfLanguageRecord();
  const language = displayLanguage(self, typeof navigator === "undefined" ? null : navigator.language);
  const value = useMemo(() => uiTranslatorFor(language), [language]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): UiTranslator {
  return useContext(I18nCtx);
}
