import { useState, useEffect, useRef } from "react";
import { useAppState } from "../../store.tsx";
import { send, addRawListener, removeRawListener } from "../../ws.ts";
import { Modal } from "./Modal.tsx";
import { dialogCancelBtn, dialogInput, dialogSaveBtn } from "./dialog-styles.ts";
import { useMemoryEditor } from "../../hooks/useMemoryEditor.ts";

type ValidationStatus = { kind: "idle" } | { kind: "pending" } | { kind: "ok"; keyCount?: number } | { kind: "error"; message: string };

export function RoomSettingsModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { rooms } = useAppState();
  const room = rooms.find((r) => r.id === roomId);
  const [prompt, setPrompt] = useState(room?.prompt ?? "");
  const [envFile, setEnvFile] = useState(room?.envFile ?? "");
  const [status, setStatus] = useState<ValidationStatus>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const roomMemory = useMemoryEditor("room", roomId, !!room);

  // Ask the server to re-validate the stored env file on open
  useEffect(() => {
    const saved = room?.envFile;
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
  }, [room?.envFile, roomId]);

  async function handleSave() {
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
    send({
      type: "update_room_settings",
      requestId: reqId,
      roomId,
      prompt: prompt.trim() ? prompt : null,
      envFile: envFile.trim() || null,
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

  return (
    <Modal onClose={onClose}>
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

      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
        Room Prompt <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>(optional, appended after office prompt)</span>
      </label>
      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. You're in the Marketing room. Match our brand voice."
        rows={8}
        style={{ ...inputStyle, resize: "vertical" }}
      />
      <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "3px 0 0" }}>Changes take effect on next conversation.</p>

      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
        Memory <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>(durable notes for this room)</span>
      </label>
      <textarea value={roomMemory.memory} onChange={(e) => roomMemory.setMemory(e.target.value)} rows={5} style={{ ...inputStyle, resize: "vertical" }} disabled={!roomMemory.loaded} />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <button onClick={onClose} style={cancelBtnStyle} disabled={saving}>
          Cancel
        </button>
        <button onClick={handleSave} style={saveBtnStyle} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
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
