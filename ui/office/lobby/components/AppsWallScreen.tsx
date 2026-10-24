import { useI18n } from "../../../i18n.tsx";

export function AppsWallScreen({ onOpenApps }: { onOpenApps?: () => void }) {
  const { t } = useI18n();
  const label = t("common.apps");
  return (
    <g
      data-no-pan
      transform="translate(50, -75) skewY(-27)"
      onClick={onOpenApps}
      aria-label={onOpenApps ? label : undefined}
      style={onOpenApps ? { cursor: "pointer", pointerEvents: "auto" } : undefined}
    >
      {onOpenApps && <title>{label}</title>}
      <rect x="-30" y="-32" width="60" height="58" rx="3" fill="var(--wall-decor)" stroke="var(--wall-decor-stroke)" strokeWidth="1.2" />
      <rect x="-25" y="-27" width="50" height="46" rx="1.5" fill="var(--bg-surface-solid, #1a1a1a)" stroke="var(--wall-decor-stroke)" strokeWidth="0.6" />
      <g fill="var(--accent)" opacity="0.85">
        <rect x="-9" y="-19" width="7" height="7" rx="1" />
        <rect x="2" y="-19" width="7" height="7" rx="1" />
        <rect x="-9" y="-8" width="7" height="7" rx="1" />
        <rect x="2" y="-8" width="7" height="7" rx="1" />
      </g>
      <text
        x="0"
        y="13"
        textAnchor="middle"
        textLength={label.length > 7 ? 44 : undefined}
        lengthAdjust="spacingAndGlyphs"
        fontSize="11"
        fontWeight="600"
        fill="var(--text-primary)"
        style={{ userSelect: "none" }}
      >
        {label}
      </text>
    </g>
  );
}
