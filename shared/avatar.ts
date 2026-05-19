export const GHOST_VARIANTS = ["classic", "big-eyes", "sleepy", "tongue-out", "stubby-arms", "wisp-tail", "nightcap", "glow-halo"] as const;

export type GhostVariant = (typeof GHOST_VARIANTS)[number];

export function isGhostVariant(value: unknown): value is GhostVariant {
  return typeof value === "string" && (GHOST_VARIANTS as readonly string[]).includes(value);
}

export const GHOST_COLOR_PALETTE = ["#88d1f0", "#94c2e8", "#a8b8e8", "#b6a8e0", "#c9b6e4", "#e0b0d8", "#f5b7c4", "#ffab91", "#ffc89c", "#ffd180", "#d6e090", "#b5e8d5"] as const;

const HEX_RE = /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

export function normalizeHexColor(value: string): string {
  const body = value.trim().toLowerCase().replace(/^#/, "");
  if (body.length === 3) return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  return `#${body}`;
}

export function defaultGhostColorForUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return GHOST_COLOR_PALETTE[hash % GHOST_COLOR_PALETTE.length];
}
