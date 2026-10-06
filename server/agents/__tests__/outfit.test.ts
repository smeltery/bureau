import { describe, expect, test } from "bun:test";
import { generateOutfit, outfitClashes } from "../outfit.ts";
import { ACCESSORIES, BEARDS, HAIR_COLORS, HAIR_STYLES, HATS, SHIRT_COLORS, SKIN_COLORS } from "../../../shared/outfit-options.ts";

// generateOutfit picks each field uniformly at random from the canonical
// option arrays. We can't assert exact equality on a single call, but a
// large-N sample lets us check (a) every field is always one of the legal
// options, and (b) over enough draws each option appears at least once.

const SAMPLE_SIZE = 500;

function sample(): ReturnType<typeof generateOutfit>[] {
  return Array.from({ length: SAMPLE_SIZE }, () => generateOutfit());
}

describe("generateOutfit shape", () => {
  test("returns an object with all 7 fields populated on every call", () => {
    for (let i = 0; i < 50; i++) {
      const o = generateOutfit();
      expect(o).toMatchObject({
        hat: expect.any(String),
        color: expect.any(String),
        hair: expect.any(String),
        hairStyle: expect.any(String),
        skin: expect.any(String),
        beard: expect.any(String),
      });
      // accessory may be null (it's part of the option list).
      expect(["string", "object"]).toContain(typeof o.accessory);
    }
  });
});

describe("generateOutfit values come from the canonical option arrays", () => {
  const outfits = sample();

  test("hat is always one of HATS", () => {
    for (const o of outfits) expect(HATS).toContain(o.hat);
  });

  test("color is always one of SHIRT_COLORS", () => {
    for (const o of outfits) expect(SHIRT_COLORS).toContain(o.color);
  });

  test("hair is always one of HAIR_COLORS", () => {
    for (const o of outfits) expect(HAIR_COLORS).toContain(o.hair);
  });

  test("hairStyle is always one of HAIR_STYLES", () => {
    for (const o of outfits) expect(HAIR_STYLES).toContain(o.hairStyle);
  });

  test("skin is always one of SKIN_COLORS", () => {
    for (const o of outfits) expect(SKIN_COLORS).toContain(o.skin);
  });

  test("beard is always one of BEARDS", () => {
    for (const o of outfits) expect(BEARDS).toContain(o.beard);
  });

  test("accessory is always one of ACCESSORIES (including null)", () => {
    for (const o of outfits) expect(ACCESSORIES).toContain(o.accessory);
  });
});

describe("generateOutfit covers the option space", () => {
  // Statistical sanity: with 500 draws and at most 8 options per field,
  // each option's expected count is 500/8 = 62.5; the chance of any one
  // option appearing 0 times is astronomically small. If this ever flakes,
  // it's far more likely a regression in `pick` than legitimate variance.
  const outfits = sample();

  test("every HATS option appears at least once", () => {
    const seen = new Set(outfits.map((o) => o.hat));
    for (const opt of HATS) expect(seen).toContain(opt);
  });

  test("every BEARDS option appears at least once", () => {
    const seen = new Set(outfits.map((o) => o.beard));
    for (const opt of BEARDS) expect(seen).toContain(opt);
  });

  test("every ACCESSORIES option appears at least once (incl. null)", () => {
    const seen = new Set(outfits.map((o) => o.accessory));
    for (const opt of ACCESSORIES) expect(seen).toContain(opt);
  });
});

describe("generateOutfit clashes", () => {
  test("never rolls a bow with a beard or bald head, or pigtails with a beard", () => {
    for (const outfit of sample()) expect(outfitClashes(outfit)).toBe(false);
  });

  test("flags exactly the clashing combinations", () => {
    const base = generateOutfit();
    expect(outfitClashes({ ...base, hat: "bow", beard: "full", hairStyle: "short" })).toBe(true);
    expect(outfitClashes({ ...base, hat: "bow", beard: "none", hairStyle: "bald" })).toBe(true);
    expect(outfitClashes({ ...base, hat: "cap", beard: "goatee", hairStyle: "pigtails" })).toBe(true);
    expect(outfitClashes({ ...base, hat: "bow", beard: "none", hairStyle: "pigtails" })).toBe(false);
  });
});
