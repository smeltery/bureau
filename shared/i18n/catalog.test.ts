// Catalog completeness: same key set as English, no empty value, same
// placeholders, same rich-text tags, and whole plural pairs. Types already
// make a missing key a compile error; bun test does not typecheck.

import { describe, expect, it } from "bun:test";
import { CATALOGS } from "./translate.ts";
import { en } from "./en.ts";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from "../languages.ts";

const ENGLISH_KEYS = Object.keys(en).sort();

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

function tags(text: string): string[] {
  return [...text.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort();
}

function tagsAreBalancedAndFlat(text: string): boolean {
  let open: string | null = null;
  for (const m of text.matchAll(/<\/?(\w+)>/g)) {
    const closing = m[0].startsWith("</");
    if (!closing) {
      if (open !== null) return false;
      open = m[1];
    } else {
      if (open !== m[1]) return false;
      open = null;
    }
  }
  return open === null;
}

function hasLoneAngleBracket(text: string): boolean {
  return text.replaceAll(/<\/?\w+>/g, "").includes(">");
}

const OTHER_LANGUAGES = SUPPORTED_LANGUAGES.map((l) => l.code).filter((code) => code !== DEFAULT_LANGUAGE);

describe("placeholders", () => {
  it("is the set of names, so repeating one is not a difference", () => {
    expect(placeholders("{name} and {name} owe {n}")).toEqual(["n", "name"]);
    expect(placeholders("no placeholder")).toEqual([]);
  });
});

describe("the catalogs", () => {
  it("cover every offered language and are non-empty", () => {
    expect(ENGLISH_KEYS.length).toBeGreaterThan(200);
    expect(OTHER_LANGUAGES).toEqual(["es", "ca"]);
    for (const code of SUPPORTED_LANGUAGES.map((l) => l.code)) expect(CATALOGS[code]).toBeDefined();
  });

  for (const code of OTHER_LANGUAGES) {
    describe(code, () => {
      const catalog = CATALOGS[code];

      it("has exactly the English keys", () => {
        expect(Object.keys(catalog).sort()).toEqual(ENGLISH_KEYS);
      });

      it("has no empty value", () => {
        for (const key of ENGLISH_KEYS) expect(catalog[key as keyof typeof en].trim(), key).not.toBe("");
      });

      it("uses the same placeholders as English", () => {
        for (const key of ENGLISH_KEYS) {
          expect(placeholders(catalog[key as keyof typeof en]), key).toEqual(placeholders(en[key as keyof typeof en]));
        }
      });

      it("uses the same rich-text tags as English, each pair closed and flat", () => {
        for (const key of ENGLISH_KEYS) {
          const text = catalog[key as keyof typeof en];
          expect(tags(text), key).toEqual(tags(en[key as keyof typeof en]));
          expect(tagsAreBalancedAndFlat(text), key).toBe(true);
        }
      });
    });
  }

  it("keeps every English tag pair closed and flat, and at least one exists", () => {
    let tagged = 0;
    for (const key of ENGLISH_KEYS) {
      const text = en[key as keyof typeof en];
      expect(tagsAreBalancedAndFlat(text), key).toBe(true);
      if (tags(text).length > 0) tagged++;
    }
    expect(tagged).toBeGreaterThan(0);
  });

  it("keeps every plural pair whole in English", () => {
    for (const key of ENGLISH_KEYS) {
      const pair = key.endsWith(".one") ? key.slice(0, -".one".length) + ".other" : key.endsWith(".other") ? key.slice(0, -".other".length) + ".one" : null;
      if (pair !== null) expect(ENGLISH_KEYS, key).toContain(pair);
    }
  });

  it("forbids lone angle brackets outside rich tags", () => {
    for (const code of [DEFAULT_LANGUAGE, ...OTHER_LANGUAGES]) {
      const catalog = CATALOGS[code];
      for (const key of ENGLISH_KEYS) {
        expect(hasLoneAngleBracket(catalog[key as keyof typeof en]), `${code} ${key}`).toBe(false);
      }
    }
  });

  it("names keys by surface and meaning, never by the English text", () => {
    for (const key of ENGLISH_KEYS) {
      expect(key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
      expect(key.toLowerCase()).not.toBe(en[key as keyof typeof en].toLowerCase());
    }
  });
});
