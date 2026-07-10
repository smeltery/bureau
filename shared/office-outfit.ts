import type { AgentOutfit } from "./types.ts";
import { ACCESSORIES, BEARDS, HAIR_COLORS, HAIR_STYLES, HATS, SHIRT_COLORS, SKIN_COLORS } from "./outfit-options.ts";

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateOutfit(): AgentOutfit {
  return {
    hat: pick(HATS),
    color: pick(SHIRT_COLORS),
    hair: pick(HAIR_COLORS),
    hairStyle: pick(HAIR_STYLES),
    skin: pick(SKIN_COLORS),
    beard: pick(BEARDS),
    accessory: pick(ACCESSORIES),
  };
}
