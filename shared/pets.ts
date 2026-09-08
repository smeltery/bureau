// Room office pets: species + named coat. Palettes live here so the server can
// validate coats without importing UI, and the scene can paint without a second
// hand-maintained list.

export interface PetPalette {
  coat: string;
  mark: string;
  inner: string;
  nose: string;
  /** Eyes / whiskers / outlines — light on dark coats so the face stays visible. */
  line: string;
  /** Dog only: dark coats use a tongue instead of a hairline mouth stroke. */
  tongue?: boolean;
}

export const PET_SPECIES = ["cat", "dog", "rabbit", "tortoise"] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];

export const CAT_COATS = ["orange", "silver", "black", "white", "ginger", "siamese"] as const;
export const DOG_COATS = ["golden", "chocolate", "black-tan", "husky", "cream"] as const;
export const RABBIT_COATS = ["dutch-grey", "chestnut", "cream", "blue"] as const;
export const TORTOISE_COATS = ["olive", "horsfield", "amber"] as const;

export type CatCoat = (typeof CAT_COATS)[number];
export type DogCoat = (typeof DOG_COATS)[number];
export type RabbitCoat = (typeof RABBIT_COATS)[number];
export type TortoiseCoat = (typeof TORTOISE_COATS)[number];

/** All coat names across species (for labels / legacy exports). */
export const ROOM_PET_COATS = [...CAT_COATS, ...DOG_COATS, ...RABBIT_COATS, ...TORTOISE_COATS] as const;
export type RoomPetCoat = (typeof ROOM_PET_COATS)[number];

export const PET_COATS: Record<PetSpecies, readonly string[]> = {
  cat: CAT_COATS,
  dog: DOG_COATS,
  rabbit: RABBIT_COATS,
  tortoise: TORTOISE_COATS,
};

export type RoomPet = { species: "cat"; coat: CatCoat } | { species: "dog"; coat: DogCoat } | { species: "rabbit"; coat: RabbitCoat } | { species: "tortoise"; coat: TortoiseCoat };

export const CAT_PALETTES: Record<CatCoat, PetPalette> = {
  orange: { coat: "#E8A050", mark: "#C08030", inner: "#D08040", nose: "#D08080", line: "#333333" },
  silver: { coat: "#A0A0A8", mark: "#707078", inner: "#909098", nose: "#C09090", line: "#333333" },
  black: { coat: "#3A3A3A", mark: "#222222", inner: "#4A4A4A", nose: "#A07070", line: "#C8C8C8" },
  white: { coat: "#E8E0D8", mark: "#C0B8B0", inner: "#DCC8C0", nose: "#D0A0A0", line: "#333333" },
  ginger: { coat: "#D07030", mark: "#A05020", inner: "#C06030", nose: "#C07060", line: "#333333" },
  siamese: { coat: "#E0D8C8", mark: "#8B7060", inner: "#C0A890", nose: "#C08888", line: "#333333" },
};

export const DOG_PALETTES: Record<DogCoat, PetPalette> = {
  golden: { coat: "#E0B070", mark: "#C08F4E", inner: "#EFCE9C", nose: "#3A3028", line: "#333333" },
  chocolate: { coat: "#7A5238", mark: "#5A3A26", inner: "#9A7052", nose: "#2E2620", line: "#EFE4D8", tongue: true },
  "black-tan": { coat: "#3C3630", mark: "#26221E", inner: "#8A6A44", nose: "#1E1A16", line: "#D8D0C4", tongue: true },
  husky: { coat: "#A8A8AE", mark: "#6E6E76", inner: "#E4E0DA", nose: "#2E2E34", line: "#333333" },
  cream: { coat: "#EFE2CC", mark: "#CDBB9C", inner: "#FAF3E6", nose: "#4A3E32", line: "#333333" },
};

export const RABBIT_PALETTES: Record<RabbitCoat, PetPalette> = {
  "dutch-grey": { coat: "#B4AEA6", mark: "#8A857E", inner: "#EAC4C4", nose: "#C08C8C", line: "#333333" },
  chestnut: { coat: "#9E7048", mark: "#7A5232", inner: "#E0B0A4", nose: "#B47C74", line: "#333333" },
  cream: { coat: "#EDDFC6", mark: "#CCB893", inner: "#F0C0BC", nose: "#C08C88", line: "#333333" },
  blue: { coat: "#8E96A2", mark: "#6A727E", inner: "#DCB6B6", nose: "#B08484", line: "#333333" },
};

export const TORTOISE_PALETTES: Record<TortoiseCoat, PetPalette> = {
  olive: { coat: "#7C8A4A", mark: "#5A6634", inner: "#B6B27C", nose: "#4A4632", line: "#2E2A20" },
  horsfield: { coat: "#9A7A46", mark: "#6E5630", inner: "#C4A874", nose: "#54462C", line: "#2E2A20" },
  amber: { coat: "#C8934A", mark: "#96682C", inner: "#E3C48E", nose: "#6A5838", line: "#2E2A20" },
};

export const PET_PALETTES: {
  cat: Record<CatCoat, PetPalette>;
  dog: Record<DogCoat, PetPalette>;
  rabbit: Record<RabbitCoat, PetPalette>;
  tortoise: Record<TortoiseCoat, PetPalette>;
} = {
  cat: CAT_PALETTES,
  dog: DOG_PALETTES,
  rabbit: RABBIT_PALETTES,
  tortoise: TORTOISE_PALETTES,
};

export const DEFAULT_ROOM_PET: RoomPet = { species: "cat", coat: "orange" };

export function isPetSpecies(value: unknown): value is PetSpecies {
  return typeof value === "string" && (PET_SPECIES as readonly string[]).includes(value);
}

function isCoatForSpecies(species: PetSpecies, coat: string): boolean {
  return (PET_COATS[species] as readonly string[]).includes(coat);
}

/** Resolve the palette a room should paint. Unknown coat/species fall back. */
export function paletteForPet(pet: RoomPet): PetPalette {
  const species = isPetSpecies(pet.species) ? pet.species : DEFAULT_ROOM_PET.species;
  const palettes = PET_PALETTES[species];
  const coat = pet.coat;
  if (typeof coat === "string" && coat in palettes) {
    return palettes[coat as keyof typeof palettes];
  }
  const fallbackCoat = PET_COATS[species][0]!;
  return palettes[fallbackCoat as keyof typeof palettes];
}

/**
 * Narrow untrusted input to a RoomPet.
 * Legacy `{ coat }` (pre-species) becomes `{ species: "cat", coat }` when the coat is a cat coat.
 */
export function normalizeRoomPet(value: unknown): RoomPet | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object") return null;
  const raw = value as { species?: unknown; coat?: unknown };
  const coat = raw.coat;
  if (typeof coat !== "string") return null;

  if (raw.species === undefined || raw.species === null) {
    // Pre-species rooms only stored a cat coat name.
    if ((CAT_COATS as readonly string[]).includes(coat)) {
      return { species: "cat", coat: coat as CatCoat };
    }
    return null;
  }

  if (!isPetSpecies(raw.species)) return null;
  if (!isCoatForSpecies(raw.species, coat)) return null;
  return { species: raw.species, coat } as RoomPet;
}
