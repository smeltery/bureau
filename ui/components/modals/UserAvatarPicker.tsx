import { GHOST_COLOR_PALETTE, GHOST_VARIANTS, type GhostVariant } from "../../../shared/avatar.ts";
import { GhostGraphic } from "../../office/ghostVariants.tsx";
import { dialogInput, dialogLabel } from "./dialog-styles.ts";

export function UserAvatarPicker({
  color,
  variant,
  onColorChange,
  onVariantChange,
}: {
  color: string;
  variant: GhostVariant;
  onColorChange: (color: string) => void;
  onVariantChange: (variant: GhostVariant) => void;
}) {
  return (
    <>
      <label style={{ ...dialogLabel, marginTop: 12 }}>Avatar</label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        {GHOST_VARIANTS.map((nextVariant) => (
          <button
            key={nextVariant}
            type="button"
            onClick={() => onVariantChange(nextVariant)}
            title={nextVariant}
            style={{
              height: 58,
              border: `1px solid ${variant === nextVariant ? "var(--accent)" : "var(--border)"}`,
              background: variant === nextVariant ? "var(--bg-hover)" : "var(--btn-surface)",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            <GhostGraphic variant={nextVariant} color={color} size={28} />
          </button>
        ))}
      </div>
      <label style={{ ...dialogLabel, marginTop: 12 }}>Avatar color</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {GHOST_COLOR_PALETTE.map((nextColor) => (
          <button
            key={nextColor}
            type="button"
            onClick={() => onColorChange(nextColor)}
            title={nextColor}
            style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              border: `2px solid ${color.toLowerCase() === nextColor ? "var(--text-primary)" : "var(--border)"}`,
              background: nextColor,
              cursor: "pointer",
            }}
          />
        ))}
        <input value={color} onChange={(e) => onColorChange(e.target.value.slice(0, 7))} style={{ ...dialogInput, width: 98, height: 28, padding: "4px 8px" }} />
      </div>
    </>
  );
}
