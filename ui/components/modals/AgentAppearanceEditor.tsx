import type { AgentOutfit } from "../../../shared/types.ts";
import { ACCESSORIES, BEARDS, COSTUMES, costumeOf, HAIR_COLORS, HAIR_STYLES, HATS, SHIRT_COLORS, SKIN_COLORS } from "../../../shared/outfit-options.ts";
import { Character } from "../../office/scene/Character.tsx";

const HAIR_STYLE_LABELS: Record<AgentOutfit["hairStyle"], string> = {
  short: "Short",
  long: "Long",
  ponytail: "Ponytail",
  bun: "Bun",
  pigtails: "Pigtails",
  curly: "Curly",
  bald: "Bald",
};

const HAT_LABELS: Record<AgentOutfit["hat"], string> = {
  none: "None",
  cap: "Cap",
  beanie: "Beanie",
  bow: "Hair Bow",
  headband: "Headband",
};

const COSTUME_LABELS: Record<NonNullable<AgentOutfit["costume"]>, string> = {
  none: "None",
  doctor: "Doctor",
  police: "Police",
  firefighter: "Firefighter",
  chef: "Chef",
  construction: "Construction",
  astronaut: "Astronaut",
};

const ACCESSORY_LABELS: Record<string, string> = {
  none: "None",
  glasses: "Glasses",
  headphones: "Headphones",
  bow_tie: "Bow Tie",
  tie: "Tie",
  earrings: "Earrings",
};

const BEARD_LABELS: Record<AgentOutfit["beard"], string> = {
  none: "None",
  stubble: "Stubble",
  full: "Full",
  goatee: "Goatee",
  mustache: "Mustache",
};

export function makeRandomOutfit(): AgentOutfit {
  return {
    hat: HATS[Math.floor(Math.random() * HATS.length)],
    costume: COSTUMES[Math.floor(Math.random() * COSTUMES.length)],
    color: SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)],
    hair: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
    hairStyle: HAIR_STYLES[Math.floor(Math.random() * HAIR_STYLES.length)],
    skin: SKIN_COLORS[Math.floor(Math.random() * SKIN_COLORS.length)],
    beard: BEARDS[Math.floor(Math.random() * BEARDS.length)],
    accessory: ACCESSORIES[Math.floor(Math.random() * ACCESSORIES.length)],
  };
}

interface AgentAppearanceEditorProps {
  outfit: AgentOutfit;
  onChange: (outfit: AgentOutfit) => void;
  selectStyle: React.CSSProperties;
}

export function AgentAppearanceEditor({ outfit, onChange, selectStyle }: AgentAppearanceEditorProps) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10 }}>
        <div style={{ width: 52, height: 70, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Character state="idle" outfit={outfit} />
        </div>
        <button onClick={() => onChange(makeRandomOutfit())} style={randomBtnStyle}>
          Randomize
        </button>
      </div>

      <ColorSwatches label="Skin" colors={SKIN_COLORS} selected={outfit.skin} onSelect={(skin) => onChange({ ...outfit, skin })} />
      <ColorSwatches label="Shirt" colors={SHIRT_COLORS} selected={outfit.color} onSelect={(color) => onChange({ ...outfit, color })} />
      <ColorSwatches label="Hair Color" colors={HAIR_COLORS} selected={outfit.hair} onSelect={(hair) => onChange({ ...outfit, hair })} />

      <div style={{ marginBottom: 8 }}>
        <div style={fieldLabelStyle}>Costume</div>
        <select value={costumeOf(outfit.costume)} onChange={(e) => onChange({ ...outfit, costume: costumeOf(e.target.value) })} style={selectStyle}>
          {COSTUMES.map((costume) => (
            <option key={costume} value={costume}>
              {COSTUME_LABELS[costume]}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={fieldLabelStyle}>Hair Style</div>
          <select value={outfit.hairStyle ?? "short"} onChange={(e) => onChange({ ...outfit, hairStyle: e.target.value as AgentOutfit["hairStyle"] })} style={selectStyle}>
            {HAIR_STYLES.map((s) => (
              <option key={s} value={s}>
                {HAIR_STYLE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={fieldLabelStyle}>Hat</div>
          <select value={outfit.hat} onChange={(e) => onChange({ ...outfit, hat: e.target.value as AgentOutfit["hat"] })} style={selectStyle}>
            {HATS.map((h) => (
              <option key={h} value={h}>
                {HAT_LABELS[h]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <div style={fieldLabelStyle}>Beard</div>
          <select value={outfit.beard ?? "none"} onChange={(e) => onChange({ ...outfit, beard: e.target.value as AgentOutfit["beard"] })} style={selectStyle}>
            {BEARDS.map((b) => (
              <option key={b} value={b}>
                {BEARD_LABELS[b]}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={fieldLabelStyle}>Accessory</div>
          <select
            value={outfit.accessory ?? "none"}
            onChange={(e) => onChange({ ...outfit, accessory: e.target.value === "none" ? null : (e.target.value as AgentOutfit["accessory"]) })}
            style={selectStyle}
          >
            {ACCESSORIES.map((a) => (
              <option key={a ?? "none"} value={a ?? "none"}>
                {ACCESSORY_LABELS[a ?? "none"]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}

interface ColorSwatchesProps<T extends string> {
  label: string;
  colors: readonly T[];
  selected: T;
  onSelect: (color: T) => void;
}

function ColorSwatches<T extends string>({ label, colors, selected, onSelect }: ColorSwatchesProps<T>) {
  return (
    <>
      <div style={fieldLabelStyle}>{label}</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
        {colors.map((c) => (
          <div
            key={c}
            onClick={() => onSelect(c)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: c,
              cursor: "pointer",
              border: selected === c ? "2px solid var(--text-primary)" : "2px solid transparent",
            }}
          />
        ))}
      </div>
    </>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-muted)",
  marginBottom: 4,
};

const randomBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 8,
  border: "1px solid var(--border-light)",
  background: "var(--bg-hover)",
  color: "var(--text-dim)",
  fontSize: 12,
  cursor: "pointer",
};
