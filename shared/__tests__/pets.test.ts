import { describe, expect, test } from "bun:test";
import { DEFAULT_ROOM_PET, normalizeRoomPet, paletteForPet, PET_COATS, PET_SPECIES } from "../pets.ts";

describe("normalizeRoomPet", () => {
  test("null and undefined clear the pet", () => {
    expect(normalizeRoomPet(null)).toBeNull();
    expect(normalizeRoomPet(undefined)).toBeNull();
  });

  test("rejects non-objects and missing coats", () => {
    expect(normalizeRoomPet("cat")).toBeNull();
    expect(normalizeRoomPet({})).toBeNull();
    expect(normalizeRoomPet({ species: "cat" })).toBeNull();
  });

  test("migrates legacy coat-only cat pets", () => {
    expect(normalizeRoomPet({ coat: "siamese" })).toEqual({ species: "cat", coat: "siamese" });
    expect(normalizeRoomPet({ coat: "golden" })).toBeNull();
  });

  test("accepts species + coat pairs for every species", () => {
    for (const species of PET_SPECIES) {
      const coat = PET_COATS[species][0]!;
      expect(normalizeRoomPet({ species, coat })).toEqual({ species, coat } as ReturnType<typeof normalizeRoomPet>);
    }
  });

  test("rejects coat that does not belong to the species", () => {
    expect(normalizeRoomPet({ species: "dog", coat: "orange" })).toBeNull();
    expect(normalizeRoomPet({ species: "cat", coat: "olive" })).toBeNull();
    expect(normalizeRoomPet({ species: "duck", coat: "orange" })).toBeNull();
  });
});

describe("paletteForPet", () => {
  test("returns a palette for the default pet", () => {
    const p = paletteForPet(DEFAULT_ROOM_PET);
    expect(p.coat).toBeString();
    expect(p.mark).toBeString();
    expect(p.line).toBeString();
  });

  test("falls back when coat is unknown for the species", () => {
    const p = paletteForPet({ species: "tortoise", coat: "orange" as "olive" });
    expect(p).toEqual(paletteForPet({ species: "tortoise", coat: "olive" }));
  });
});
