import { useI18n } from "../../i18n.tsx";
import { GHOST_COLOR_PALETTE, GHOST_VARIANTS, type GhostVariant } from "../../../shared/avatar.ts";
import { GhostGraphic } from "../../office/ghostVariants.tsx";
import { dialogInput, dialogLabel } from "./dialog-styles.ts";

const AVATAR_LABELS = {
  classic: "profile.classic",
  "big-eyes": "profile.bigEyes",
  sleepy: "profile.sleepy",
  "tongue-out": "profile.tongueOut",
  "stubby-arms": "profile.stubbyArms",
  "wisp-tail": "profile.wispTail",
  nightcap: "profile.nightcap",
  "glow-halo": "profile.glowHalo",
} as const;

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
  const { t } = useI18n();
  return (
    <>
      <label style={{ ...dialogLabel, marginTop: 12 }}>{t("profile.avatar")}</label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        {GHOST_VARIANTS.map((nextVariant) => (
          <button
            key={nextVariant}
            type="button"
            onClick={() => onVariantChange(nextVariant)}
            title={t(AVATAR_LABELS[nextVariant])}
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
      <label style={{ ...dialogLabel, marginTop: 12 }}>{t("profile.avatarColor")}</label>
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
        <input aria-label={t("profile.avatarColor")} value={color} onChange={(e) => onColorChange(e.target.value.slice(0, 7))} style={{ ...dialogInput, width: 98, height: 28, padding: "4px 8px" }} />
      </div>
    </>
  );
}
