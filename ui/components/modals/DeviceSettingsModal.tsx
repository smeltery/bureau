import { useState } from "react";
import { getDevice, setDevice } from "../../device-settings.ts";
import { Modal } from "./Modal.tsx";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "./dialog-styles.ts";
import { UnsavedChangesPrompt, useUnsavedChangesPrompt } from "./UnsavedChangesPrompt.tsx";

export function DeviceSettingsModal({ onClose }: { onClose: () => void }) {
  const [baseline] = useState(() => getDevice() ?? "");
  const [label, setLabel] = useState(baseline);
  const dirty = label !== baseline;
  const discardPrompt = useUnsavedChangesPrompt(dirty, undefined, () => setLabel(baseline));
  const requestClose = () => discardPrompt.requestLeave(onClose);

  function save() {
    setDevice(label.trim() || null);
    onClose();
  }

  return (
    <Modal onClose={requestClose} width={420}>
      <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>Device Settings</h3>
      <p style={{ fontSize: 11, color: "var(--text-ghost)", margin: "6px 0 0", lineHeight: 1.4 }}>Stored locally in this browser. Used to distinguish this device from your other sessions.</p>

      <label style={{ ...dialogLabel, marginTop: 16 }}>
        Device Label <span style={dialogHint}>(optional)</span>
      </label>
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value.slice(0, 24))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) save();
        }}
        maxLength={24}
        placeholder="Phone, Laptop, iPad"
        style={dialogInput}
      />

      {discardPrompt.open && <UnsavedChangesPrompt onDiscard={discardPrompt.discard} onCancel={discardPrompt.cancel} />}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <button onClick={requestClose} style={dialogCancelBtn}>
          Cancel
        </button>
        <button onClick={save} style={dialogSaveBtn}>
          Save
        </button>
      </div>
    </Modal>
  );
}
