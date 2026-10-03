import { useState, useEffect, useRef } from "react";
import { useAppState } from "../../store.tsx";
import { send, addRawListener, removeRawListener } from "../../ws.ts";
import { Modal } from "./Modal.tsx";
import { dialogCancelBtn, dialogInput, dialogSaveBtn } from "./dialog-styles.ts";
import { useMemoryEditor } from "../../hooks/useMemoryEditor.ts";
import { ExpandableTextarea } from "./ExpandableTextarea.tsx";
import {
  DEFAULT_ROOM_PET,
  PET_COATS,
  PET_SPECIES,
  ROOM_DECOR_IDS,
  SELECTABLE_ROOM_SKIN_IDS,
  effectiveRoomDecor,
  effectiveRoomSkin,
  type PetSpecies,
  type RoomDecor,
  type RoomPet,
  type RoomSkin,
} from "../../../shared/types.ts";
import { UnsavedChangesPrompt, useUnsavedChangesPrompt } from "./UnsavedChangesPrompt.tsx";

type ValidationStatus = { kind: "idle" } | { kind: "pending" } | { kind: "ok"; keyCount?: number } | { kind: "error"; message: string };

type RoomBaseline = {
  prompt: string;
  envFile: string;
  petSpecies: PetSpecies;
  petCoat: string;
  skin: RoomSkin;
  decor: RoomDecor;
};

function defaultCoatFor(species: PetSpecies): string {
  return PET_COATS[species][0]!;
}

export function RoomSettingsModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { rooms } = useAppState();
  const room = rooms.find((r) => r.id === roomId);
  const [prompt, setPrompt] = useState(room?.prompt ?? "");
  const [envFile, setEnvFile] = useState(room?.envFile ?? "");
  const initialPet = room?.pet ?? DEFAULT_ROOM_PET;
  const [petSpecies, setPetSpecies] = useState<PetSpecies>(initialPet.species);
  const [petCoat, setPetCoat] = useState<string>(initialPet.coat);
  const [skin, setSkin] = useState<RoomSkin>(effectiveRoomSkin(room));
  const [decor, setDecor] = useState<RoomDecor>(effectiveRoomDecor(room));
  const [baseline, setBaseline] = useState<RoomBaseline | null>(null);
  const [status, setStatus] = useState<ValidationStatus>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const roomMemory = useMemoryEditor("room", roomId, !!room);

  const dirty =
    !!baseline &&
    (prompt !== baseline.prompt ||
      envFile !== baseline.envFile ||
      petSpecies !== baseline.petSpecies ||
      petCoat !== baseline.petCoat ||
      skin !== baseline.skin ||
      decor !== baseline.decor ||
      roomMemory.dirty);

  const discardPrompt = useUnsavedChangesPrompt(dirty, undefined, () => {
    if (!baseline) return;
    setPrompt(baseline.prompt);
    setEnvFile(baseline.envFile);
    setPetSpecies(baseline.petSpecies);
    setPetCoat(baseline.petCoat);
    setSkin(baseline.skin);
    setDecor(baseline.decor);
    roomMemory.reset();
    setStatus({ kind: "idle" });
  });

  // Pin the optimistic-concurrency version from a GET on open (same rail as office settings).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/rooms/${encodeURIComponent(roomId)}/settings`, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error("could not load room settings");
        return (await res.json()) as { prompt: string | null; envFile: string | null; pet?: RoomPet | null; skin?: RoomSkin | null; decor?: RoomDecor | null; version: string };
      })
      .then((data) => {
        if (cancelled) return;
        const pet = data.pet ?? DEFAULT_ROOM_PET;
        const next: RoomBaseline = {
          prompt: data.prompt ?? "",
          envFile: data.envFile ?? "",
          petSpecies: pet.species,
          petCoat: pet.coat,
          skin: effectiveRoomSkin({ skin: data.skin }),
          decor: effectiveRoomDecor({ decor: data.decor }),
        };
        setPrompt(next.prompt);
        setEnvFile(next.envFile);
        setPetSpecies(next.petSpecies);
        setPetCoat(next.petCoat);
        setSkin(next.skin);
        setDecor(next.decor);
        setBaseline(next);
        setSettingsVersion(data.version);
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: "error", message: "Could not load room settings version. Reopen and try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Ask the server to re-validate the stored env file once the GET version lands
  useEffect(() => {
    if (!settingsVersion) return;
    const saved = envFile;
    if (!saved) {
      setStatus({ kind: "idle" });
      return;
    }
    const reqId = `room-open-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setStatus({ kind: "pending" });
    const listener = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "settings_validation" && msg.requestId === reqId) {
          if (msg.ok) setStatus({ kind: "ok", keyCount: msg.keyCount });
          else setStatus({ kind: "error", message: msg.error || "Invalid env file" });
          removeRawListener(listener);
        }
      } catch {}
    };
    addRawListener(listener);
    send({ type: "request_settings_validation", requestId: reqId, scope: "room", roomId });
    return () => removeRawListener(listener);
  }, [settingsVersion]);

  async function handleSave() {
    if (!settingsVersion) {
      setStatus({ kind: "error", message: "Room settings version is still loading. Try again in a moment." });
      return;
    }
    const memoryResult = await roomMemory.save();
    if (!memoryResult.ok) {
      setStatus({ kind: "error", message: memoryResult.message });
      return;
    }
    const reqId = `room-save-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setSaving(true);
    const listener = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "settings_save_response" && msg.requestId === reqId) {
          setSaving(false);
          removeRawListener(listener);
          if (msg.ok) {
            onClose();
          } else {
            setStatus({ kind: "error", message: msg.error || "Save failed" });
          }
        }
      } catch {}
    };
    addRawListener(listener);
    const pet = { species: petSpecies, coat: petCoat } as RoomPet;
    send({
      type: "update_room_settings",
      requestId: reqId,
      roomId,
      prompt: prompt.trim() ? prompt : null,
      envFile: envFile.trim() || null,
      pet,
      skin,
      decor,
      version: settingsVersion,
    });
  }

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, []);

  if (!room) return null;

  const requestClose = () => discardPrompt.requestLeave(onClose);

  return (
    <Modal onClose={requestClose}>
      <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{room.name} · Settings</h3>

      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 18, marginBottom: 5 }}>
        Env File Path <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>(optional, absolute path)</span>
      </label>
      <input
        value={envFile}
        onChange={(e) => {
          setEnvFile(e.target.value);
          setStatus({ kind: "idle" });
        }}
        placeholder="/home/you/.secrets/room.env"
        style={inputStyle}
      />
      <ValidationLine status={status} />

      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>Look</label>
      <select value={skin} onChange={(e) => setSkin(e.target.value as RoomSkin)} style={inputStyle}>
        {SELECTABLE_ROOM_SKIN_IDS.map((id) => (
          <option key={id} value={id}>
            {id === "office" ? "Office" : id === "hospital" ? "Hospital" : id}
          </option>
        ))}
        {!SELECTABLE_ROOM_SKIN_IDS.includes(skin) && <option value={skin}>{skin} (stored)</option>}
      </select>

      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>Decor</label>
      <select value={decor} onChange={(e) => setDecor(e.target.value as RoomDecor)} style={inputStyle}>
        {ROOM_DECOR_IDS.map((id) => (
          <option key={id} value={id}>
            {decorLabel(id)}
          </option>
        ))}
      </select>

      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>Room Pet</label>
      <div style={{ display: "flex", gap: 8 }}>
        <select
          value={petSpecies}
          onChange={(e) => {
            const next = e.target.value as PetSpecies;
            setPetSpecies(next);
            const coats = PET_COATS[next] as readonly string[];
            setPetCoat(coats.includes(petCoat) ? petCoat : defaultCoatFor(next));
          }}
          style={{ ...inputStyle, flex: 1 }}
        >
          {PET_SPECIES.map((species) => (
            <option key={species} value={species}>
              {speciesLabel(species)}
            </option>
          ))}
        </select>
        <select value={petCoat} onChange={(e) => setPetCoat(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
          {PET_COATS[petSpecies].map((coat) => (
            <option key={coat} value={coat}>
              {coatLabel(coat)}
            </option>
          ))}
        </select>
      </div>

      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
        Room Prompt <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>(optional, appended after office prompt)</span>
      </label>
      <ExpandableTextarea
        textareaRef={textareaRef}
        title={`${room.name} · Room Prompt`}
        hint="Changes take effect on next conversation."
        value={prompt}
        onChange={setPrompt}
        placeholder="e.g. You're in the Marketing room. Match our brand voice."
        rows={8}
        style={{ ...inputStyle, resize: "vertical" }}
      />
      <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "3px 0 0" }}>Changes take effect on next conversation.</p>

      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
        Memory{" "}
        <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>
          (durable notes for this room; {roomMemory.size} / {roomMemory.cap ?? "..."})
        </span>
      </label>
      <ExpandableTextarea
        title={`${room.name} · Memory`}
        hint="This editor rewrites the file exactly as shown. Use one memory per line; keep existing author/date text unless you mean to change it."
        value={roomMemory.memory}
        onChange={roomMemory.setMemory}
        rows={5}
        style={{ ...inputStyle, resize: "vertical" }}
        disabled={!roomMemory.loaded}
      />

      {discardPrompt.open && <UnsavedChangesPrompt onDiscard={discardPrompt.discard} onCancel={discardPrompt.cancel} />}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <button onClick={requestClose} style={cancelBtnStyle} disabled={saving}>
          Cancel
        </button>
        <button onClick={handleSave} style={saveBtnStyle} disabled={saving || !settingsVersion}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function speciesLabel(species: PetSpecies): string {
  return species[0]!.toUpperCase() + species.slice(1);
}

function coatLabel(coat: string): string {
  return coat
    .split("-")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function decorLabel(decor: RoomDecor): string {
  if (decor === "minimal") return "Minimal";
  if (decor === "lively") return "Lively";
  return "Standard";
}

function ValidationLine({ status }: { status: ValidationStatus }) {
  if (status.kind === "idle") return null;
  if (status.kind === "pending") {
    return <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "4px 0 0" }}>Checking…</p>;
  }
  if (status.kind === "ok") {
    return (
      <p style={{ fontSize: 10, color: "var(--accent)", margin: "4px 0 0" }}>
        Loaded {status.keyCount ?? 0} variable{status.keyCount === 1 ? "" : "s"}.
      </p>
    );
  }
  return <p style={{ fontSize: 10, color: "#ff6b6b", margin: "4px 0 0" }}>{status.message}</p>;
}

const inputStyle: React.CSSProperties = dialogInput;
const cancelBtnStyle: React.CSSProperties = { ...dialogCancelBtn, fontFamily: "'DM Sans',sans-serif" };
const saveBtnStyle: React.CSSProperties = { ...dialogSaveBtn, fontFamily: "'DM Sans',sans-serif" };
