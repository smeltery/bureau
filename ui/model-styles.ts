export type DeskProp = "book" | "crayons";

export interface ModelStyle {
  border: string;
  bg: string;
  deskProp?: DeskProp;
}

export const MODEL_STYLES: Record<string, ModelStyle> = {
  opus: { border: "rgba(100,160,255,0.85)", bg: "rgba(100,160,255,0.35)", deskProp: "book" },
  fable: { border: "rgba(170,130,255,0.85)", bg: "rgba(170,130,255,0.35)", deskProp: "book" },
  sonnet: { border: "rgba(218,165,32,0.80)", bg: "rgba(218,165,32,0.32)" },
  haiku: { border: "rgba(230,130,180,0.80)", bg: "rgba(230,130,180,0.32)", deskProp: "crayons" },
  "gpt-5.6-sol": { border: "rgba(80,220,150,0.95)", bg: "rgba(80,220,150,0.40)", deskProp: "book" },
  "gpt-6.1-sol": { border: "rgba(40,235,170,0.95)", bg: "rgba(40,235,170,0.40)", deskProp: "book" },
  "gpt-6-astra": { border: "rgba(60,230,190,0.95)", bg: "rgba(60,230,190,0.40)", deskProp: "book" },
  "gpt-6-sol": { border: "rgba(60,230,160,0.90)", bg: "rgba(60,230,160,0.36)", deskProp: "book" },
  "gpt-6-luna": { border: "rgba(60,210,170,0.60)", bg: "rgba(60,210,170,0.20)", deskProp: "crayons" },
  "gpt-5.6-terra": { border: "rgba(80,200,140,0.80)", bg: "rgba(80,200,140,0.30)" },
  "gpt-5.6-luna": { border: "rgba(80,200,140,0.60)", bg: "rgba(80,200,140,0.20)", deskProp: "crayons" },
  "gpt-5.5": { border: "rgba(120,220,160,0.90)", bg: "rgba(120,220,160,0.36)" },
  "gpt-5.4": { border: "rgba(120,220,160,0.78)", bg: "rgba(120,220,160,0.28)" },
  "gpt-5.4-mini": { border: "rgba(120,220,160,0.62)", bg: "rgba(120,220,160,0.20)", deskProp: "crayons" },
};

export const NEUTRAL_STYLE: ModelStyle = {
  border: "var(--border-medium)",
  bg: "var(--bg-tag)",
};

export const FALLBACK_PALETTE: readonly ModelStyle[] = [
  { border: "rgba(235,110,100,0.80)", bg: "rgba(235,110,100,0.30)" },
  { border: "rgba(240,160,70,0.80)", bg: "rgba(240,160,70,0.30)" },
  { border: "rgba(170,210,90,0.80)", bg: "rgba(170,210,90,0.30)" },
  { border: "rgba(70,200,210,0.80)", bg: "rgba(70,200,210,0.30)" },
  { border: "rgba(110,150,220,0.80)", bg: "rgba(110,150,220,0.30)" },
  { border: "rgba(220,110,220,0.80)", bg: "rgba(220,110,220,0.30)" },
  { border: "rgba(200,175,140,0.80)", bg: "rgba(200,175,140,0.30)" },
  { border: "rgba(150,220,190,0.80)", bg: "rgba(150,220,190,0.30)" },
];

function paletteIndex(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33 + value.charCodeAt(i)) >>> 0;
  }
  return hash % FALLBACK_PALETTE.length;
}

export function styleForModel(modelFamily: string | undefined): ModelStyle {
  if (!modelFamily) return NEUTRAL_STYLE;
  if (Object.hasOwn(MODEL_STYLES, modelFamily)) return MODEL_STYLES[modelFamily];
  return FALLBACK_PALETTE[paletteIndex(modelFamily)];
}
