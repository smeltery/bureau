import { keyFrom, type PlainMessageKey, type Translator } from "../../../../shared/i18n/translate.ts";
import type { PetSpecies, RoomDecor } from "../../../../shared/types.ts";

export const DECOR_LABELS = { minimal: "settingsUi.minimal", standard: "settingsUi.standard", lively: "settingsUi.lively" } as const satisfies Record<RoomDecor, PlainMessageKey>;
export const PET_LABELS = { cat: "settingsUi.pet.cat", dog: "settingsUi.pet.dog", rabbit: "settingsUi.pet.rabbit", tortoise: "settingsUi.pet.tortoise" } as const satisfies Record<
  PetSpecies,
  PlainMessageKey
>;
const COAT_LABELS = {
  orange: "settingsUi.pet.orange",
  silver: "settingsUi.pet.silver",
  black: "settingsUi.pet.black",
  white: "settingsUi.pet.white",
  ginger: "settingsUi.pet.ginger",
  siamese: "settingsUi.pet.siamese",
  golden: "settingsUi.pet.golden",
  chocolate: "settingsUi.pet.chocolate",
  "black-tan": "settingsUi.pet.blackTan",
  husky: "settingsUi.pet.husky",
  cream: "settingsUi.pet.cream",
  "dutch-grey": "settingsUi.pet.dutchGrey",
  chestnut: "settingsUi.pet.chestnut",
  blue: "settingsUi.pet.blue",
  olive: "settingsUi.pet.olive",
  horsfield: "settingsUi.pet.horsfield",
  amber: "settingsUi.pet.amber",
} as const satisfies Record<string, PlainMessageKey>;

export function petCoatLabel(coat: string, t: Translator["t"]): string {
  const key = keyFrom(COAT_LABELS, coat);
  return key ? t(key) : coat;
}
