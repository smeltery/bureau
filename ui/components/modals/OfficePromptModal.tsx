import { useState, useEffect, useRef } from "react";
import { useAppState } from "../../store.tsx";
import { send, addRawListener, removeRawListener } from "../../ws.ts";
import { Modal } from "./Modal.tsx";
import { dialogCancelBtn, dialogInput, dialogSaveBtn } from "./dialog-styles.ts";
import { useMemoryEditor } from "../../hooks/useMemoryEditor.ts";
import { ExpandableTextarea } from "./ExpandableTextarea.tsx";

type ValidationStatus = { kind: "idle" } | { kind: "pending" } | { kind: "ok"; keyCount?: number } | { kind: "error"; message: string };

export function OfficePromptModal({ onClose, username, onSaveUsername }: { onClose: () => void; username: string; onSaveUsername: (name: string) => void }) {
  const { office, sessionContext } = useAppState();
  const [text, setText] = useState(office.prompt ?? "");
  const [envFile, setEnvFile] = useState(office.envFile ?? "");
  const [settingsVersion, setSettingsVersion] = useState<string | null>(null);
  const [name, setName] = useState(username);
  const [status, setStatus] = useState<ValidationStatus>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestIdRef = useRef<string>("");
  const officeMemory = useMemoryEditor("office", null);
  const bossMemory = useMemoryEditor("boss", sessionContext?.userId ?? null, !!sessionContext?.userId);

  // Pin the optimistic-concurrency version from a GET on open (same rail as room
  // settings / memory). Store may lag a concurrent tab's save until WS lands.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/office/settings", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error("could not load office settings");
        return (await res.json()) as { prompt: string | null; envFile: string | null; version: string };
      })
      .then((data) => {
        if (cancelled) return;
        setText(data.prompt ?? "");
        setEnvFile(data.envFile ?? "");
        setSettingsVersion(data.version);
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: "error", message: "Could not load office settings version. Reopen and try again." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-validate the saved env file once the GET version lands (not on every keystroke).
  useEffect(() => {
    if (!settingsVersion) return;
    const saved = envFile;
    if (!saved) {
      setStatus({ kind: "idle" });
      return;
    }
    const reqId = `office-open-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    requestIdRef.current = reqId;
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
    send({ type: "request_settings_validation", requestId: reqId, scope: "office" });
    return () => removeRawListener(listener);
  }, [settingsVersion]);

  async function handleSave() {
    if (!settingsVersion) {
      setStatus({ kind: "error", message: "Office settings version is still loading. Try again in a moment." });
      return;
    }
    const memoryResult = await officeMemory.save();
    if (!memoryResult.ok) {
      setStatus({ kind: "error", message: memoryResult.message });
      return;
    }
    const bossMemoryResult = await bossMemory.save();
    if (!bossMemoryResult.ok) {
      setStatus({ kind: "error", message: bossMemoryResult.message });
      return;
    }
    const reqId = `office-save-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    requestIdRef.current = reqId;
    setSaving(true);
    const listener = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "settings_save_response" && msg.requestId === reqId) {
          setSaving(false);
          removeRawListener(listener);
          if (msg.ok) {
            if (name.trim() && name.trim() !== username) onSaveUsername(name.trim());
            onClose();
          } else {
            setStatus({ kind: "error", message: msg.error || "Save failed" });
          }
        }
      } catch {}
    };
    addRawListener(listener);
    send({
      type: "update_office_settings",
      requestId: reqId,
      prompt: text.trim() ? text : null,
      envFile: envFile.trim() || null,
      version: settingsVersion,
    });
  }

  // Place cursor at end of text on mount
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, []);

  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>Office Settings</h3>

      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 18, marginBottom: 5 }}>Boss Title</label>
      <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />

      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
        Env File Path <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>(optional, absolute path)</span>
      </label>
      <input
        value={envFile}
        onChange={(e) => {
          setEnvFile(e.target.value);
          setStatus({ kind: "idle" });
        }}
        placeholder="/home/you/.secrets/office.env"
        style={inputStyle}
      />
      <ValidationLine status={status} />

      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
        Rules <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>(system prompt for all agents)</span>
      </label>
      <ExpandableTextarea
        textareaRef={textareaRef}
        title="Office Rules"
        hint="System prompt for all agents. Changes take effect on next conversation."
        value={text}
        onChange={setText}
        placeholder="e.g. Always write tests. Use TypeScript. Be concise."
        rows={8}
        style={{ ...inputStyle, resize: "vertical" }}
      />
      <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "3px 0 0" }}>Changes take effect on next conversation.</p>

      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
        Memory{" "}
        <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>
          (durable notes for all agents; {officeMemory.size} / {officeMemory.cap ?? "..."})
        </span>
      </label>
      <ExpandableTextarea
        title="Office Memory"
        hint="This editor rewrites the file exactly as shown. Use one memory per line; keep existing author/date text unless you mean to change it."
        value={officeMemory.memory}
        onChange={officeMemory.setMemory}
        rows={5}
        style={{ ...inputStyle, resize: "vertical" }}
        disabled={!officeMemory.loaded}
      />

      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
        My Memory{" "}
        <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>
          (durable notes for agents you spawn; {bossMemory.size} / {bossMemory.cap ?? "..."})
        </span>
      </label>
      <ExpandableTextarea
        title="My Memory"
        hint="This editor rewrites the file exactly as shown. Use one memory per line; keep existing author/date text unless you mean to change it."
        value={bossMemory.memory}
        onChange={bossMemory.setMemory}
        rows={5}
        style={{ ...inputStyle, resize: "vertical" }}
        disabled={!bossMemory.loaded}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <button onClick={onClose} style={cancelBtnStyle} disabled={saving}>
          Cancel
        </button>
        <button onClick={handleSave} style={saveBtnStyle} disabled={saving || !settingsVersion}>
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
const cancelBtnStyle: React.CSSProperties = dialogCancelBtn;
const saveBtnStyle: React.CSSProperties = dialogSaveBtn;
