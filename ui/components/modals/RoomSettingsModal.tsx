import { DECOR_LABELS, PET_LABELS, petCoatLabel } from "./settings/appearance-labels.ts";
import { useI18n } from "../../i18n.tsx";
import { ValidationLine, type ValidationStatus } from "./settings/ValidationLine.tsx";
import { useSaveGuard } from "../../hooks/settings/useSaveGuard.ts";
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
  const { t, language } = useI18n();
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
  const saveGuard = useSaveGuard();
  const { saving } = saveGuard;
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
        if (!cancelled) setStatus({ kind: "error", message: { key: "settingsUi.roomLoadFailed" } });
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
          else setStatus({ kind: "error", message: msg.error || { key: "settings.profile.envInvalid" } });
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
      setStatus({ kind: "error", message: { key: "settingsUi.roomLoading" } });
      return;
    }
    if (!saveGuard.begin()) return;
    const memoryResult = await roomMemory.save();
    if (!saveGuard.active()) return;
    if (!memoryResult.ok) {
      saveGuard.finish();
      setStatus({ kind: "error", message: memoryResult.feedback ?? memoryResult.message });
      return;
    }
    const reqId = `room-save-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const listener = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "settings_save_response" && msg.requestId === reqId) {
          saveGuard.finish();
          if (msg.ok) {
            onClose();
          } else {
            setStatus({ kind: "error", message: msg.error || { key: "settingsUi.saveFailed" } });
          }
        }
      } catch {}
    };
    saveGuard.listen(listener);
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
    if (ta && settingsVersion) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, [settingsVersion]);

  if (!room) return null;

  const requestClose = () => {
    if (!saveGuard.pending()) discardPrompt.requestLeave(onClose);
  };

  return (
    <Modal onClose={requestClose}>
      <fieldset disabled={saving || !settingsVersion} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{t("settingsUi.roomTitle", { name: room.name })}</h3>

        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 18, marginBottom: 5 }}>
          {t("settings.profile.envFilePath")} <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>{t("settingsUi.absoluteOptional")}</span>
        </label>
        <input
          aria-label={t("settings.profile.envFilePath")}
          value={envFile}
          onChange={(e) => {
            setEnvFile(e.target.value);
            setStatus({ kind: "idle" });
          }}
          placeholder="/home/you/.secrets/room.env"
          style={inputStyle}
        />
        {!settingsVersion && status.kind === "idle" && (
          <p role="status" style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {t("common.loading")}
          </p>
        )}
        <ValidationLine status={status} />

        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>{t("settingsUi.look")}</label>
        <select aria-label={t("settingsUi.look")} value={skin} onChange={(e) => setSkin(e.target.value as RoomSkin)} style={inputStyle}>
          {SELECTABLE_ROOM_SKIN_IDS.map((id) => (
            <option key={id} value={id}>
              {id === "office" ? t("common.office") : id === "hospital" ? t("settingsUi.hospital") : id}
            </option>
          ))}
          {!SELECTABLE_ROOM_SKIN_IDS.includes(skin) && <option value={skin}>{t("settingsUi.stored", { name: skin })}</option>}
        </select>

        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>{t("settingsUi.decor")}</label>
        <select aria-label={t("settingsUi.decor")} value={decor} onChange={(e) => setDecor(e.target.value as RoomDecor)} style={inputStyle}>
          {ROOM_DECOR_IDS.map((id) => (
            <option key={id} value={id}>
              {t(DECOR_LABELS[id])}
            </option>
          ))}
        </select>

        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>{t("settingsUi.roomPet")}</label>
        <div style={{ display: "flex", gap: 8 }}>
          <select
            aria-label={t("settingsUi.petSpecies")}
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
                {t(PET_LABELS[species])}
              </option>
            ))}
          </select>
          <select aria-label={t("settingsUi.petCoat")} value={petCoat} onChange={(e) => setPetCoat(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
            {PET_COATS[petSpecies].map((coat) => (
              <option key={coat} value={coat}>
                {petCoatLabel(coat, t)}
              </option>
            ))}
          </select>
        </div>

        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
          {t("settingsUi.roomPrompt")} <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>{t("settingsUi.roomPromptScope")}</span>
        </label>
        <ExpandableTextarea
          textareaRef={textareaRef}
          title={t("settingsUi.roomPromptTitle", { name: room.name })}
          hint={t("settingsUi.nextConversation")}
          value={prompt}
          onChange={setPrompt}
          placeholder={t("settingsUi.roomPromptPlaceholder")}
          rows={8}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "3px 0 0" }}>{t("settingsUi.nextConversation")}</p>

        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
          {t("settingsUi.memory")}{" "}
          <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>
            {t("settingsUi.roomMemorySize", { size: roomMemory.size.toLocaleString(language), cap: roomMemory.cap?.toLocaleString(language) ?? "…" })}
          </span>
        </label>
        <ExpandableTextarea
          title={t("settingsUi.roomMemoryTitle", { name: room.name })}
          hint={t("settingsUi.memoryHint")}
          value={roomMemory.memory}
          onChange={roomMemory.setMemory}
          rows={5}
          style={{ ...inputStyle, resize: "vertical" }}
          disabled={!roomMemory.loaded}
        />
      </fieldset>

      {discardPrompt.open && <UnsavedChangesPrompt onDiscard={discardPrompt.discard} onCancel={discardPrompt.cancel} />}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <button onClick={requestClose} style={cancelBtnStyle} disabled={saving}>
          {t("common.cancel")}
        </button>
        <button onClick={handleSave} style={saveBtnStyle} disabled={saving || !settingsVersion}>
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </Modal>
  );
}

const inputStyle: React.CSSProperties = dialogInput;
const cancelBtnStyle: React.CSSProperties = { ...dialogCancelBtn, fontFamily: "'DM Sans',sans-serif" };
const saveBtnStyle: React.CSSProperties = { ...dialogSaveBtn, fontFamily: "'DM Sans',sans-serif" };
