import type { AgentOutfit } from "../../shared/types.ts";
import { SHIRT_COLORS, HAIR_COLORS, SKIN_COLORS, HAIR_STYLES, BEARDS, HATS, ACCESSORIES, COSTUMES } from "../../shared/outfit-options.ts";

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rollOutfit(): AgentOutfit {
  return {
    hat: pick(HATS),
    costume: pick(COSTUMES),
    color: pick(SHIRT_COLORS),
    hair: pick(HAIR_COLORS),
    hairStyle: pick(HAIR_STYLES),
    skin: pick(SKIN_COLORS),
    beard: pick(BEARDS),
    accessory: pick(ACCESSORIES),
  };
}

// Combinations a person can still pick by hand, but that look like a sprite
// glitch when they come out of the dice: a hair bow with a beard or no hair,
// and pigtails with a beard.
export function outfitClashes(outfit: AgentOutfit): boolean {
  const bearded = outfit.beard !== "none";
  return (outfit.hat === "bow" && (bearded || outfit.hairStyle === "bald")) || (bearded && outfit.hairStyle === "pigtails");
}

export function generateOutfit(): AgentOutfit {
  let outfit = rollOutfit();
  while (outfitClashes(outfit)) outfit = rollOutfit();
  return outfit;
}
