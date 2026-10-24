import { MemoryLoadFeedback } from "./settings/MemoryLoadFeedback.tsx";
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
import { UnsavedChangesPrompt, useUnsavedChangesPrompt } from "./UnsavedChangesPrompt.tsx";

type OfficeBaseline = {
  text: string;
  envFile: string;
  browserPanel: boolean;
  receptionistAgentId: string;
};

export function OfficePromptModal({ onClose, username, onSaveUsername }: { onClose: () => void; username: string; onSaveUsername: (name: string) => void }) {
  const { t, language } = useI18n();
  const { office, sessionContext, agents } = useAppState();
  const [text, setText] = useState(office.prompt ?? "");
  const [envFile, setEnvFile] = useState(office.envFile ?? "");
  const [browserPanel, setBrowserPanel] = useState(office.experimental?.browserPanel === true);
  const [receptionistAgentId, setReceptionistAgentId] = useState<string>(office.receptionistAgentId ?? "");
  const [settingsVersion, setSettingsVersion] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<OfficeBaseline | null>(null);
  const [name, setName] = useState(username);
  const [status, setStatus] = useState<ValidationStatus>({ kind: "idle" });
  const saveGuard = useSaveGuard();
  const { saving } = saveGuard;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestIdRef = useRef<string>("");
  const officeMemory = useMemoryEditor("office", null);
  const bossMemory = useMemoryEditor("boss", sessionContext?.userId ?? null, !!sessionContext?.userId);
  const isOwner = sessionContext?.role === "owner";

  const dirty =
    !!baseline &&
    (name.trim() !== username ||
      text !== baseline.text ||
      envFile !== baseline.envFile ||
      browserPanel !== baseline.browserPanel ||
      receptionistAgentId !== baseline.receptionistAgentId ||
      officeMemory.dirty ||
      bossMemory.dirty);

  const discardPrompt = useUnsavedChangesPrompt(dirty, undefined, () => {
    if (!baseline) return;
    setName(username);
    setText(baseline.text);
    setEnvFile(baseline.envFile);
    setBrowserPanel(baseline.browserPanel);
    setReceptionistAgentId(baseline.receptionistAgentId);
    officeMemory.reset();
    bossMemory.reset();
    setStatus({ kind: "idle" });
  });

  // Pin the optimistic-concurrency version from a GET on open (same rail as room
  // settings / memory). Store may lag a concurrent tab's save until WS lands.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/office/settings", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error("could not load office settings");
        return (await res.json()) as {
          prompt: string | null;
          envFile: string | null;
          version: string;
          experimental?: { browserPanel?: boolean };
          receptionistAgentId?: string | null;
        };
      })
      .then((data) => {
        if (cancelled) return;
        const next: OfficeBaseline = {
          text: data.prompt ?? "",
          envFile: data.envFile ?? "",
          browserPanel: data.experimental?.browserPanel === true,
          receptionistAgentId: data.receptionistAgentId ?? "",
        };
        setText(next.text);
        setEnvFile(next.envFile);
        setBrowserPanel(next.browserPanel);
        setReceptionistAgentId(next.receptionistAgentId);
        setBaseline(next);
        setSettingsVersion(data.version);
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: "error", message: { key: "settingsUi.officeLoadFailed" } });
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
          else setStatus({ kind: "error", message: msg.error || { key: "settings.profile.envInvalid" } });
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
      setStatus({ kind: "error", message: { key: "settingsUi.officeLoading" } });
      return;
    }
    if (!saveGuard.begin()) return;
    const memoryResult = await officeMemory.save();
    if (!saveGuard.active()) return;
    if (!memoryResult.ok) {
      saveGuard.finish();
      setStatus({ kind: "error", message: memoryResult.feedback ?? memoryResult.message });
      return;
    }
    const bossMemoryResult = await bossMemory.save();
    if (!saveGuard.active()) return;
    if (!bossMemoryResult.ok) {
      saveGuard.finish();
      setStatus({ kind: "error", message: bossMemoryResult.feedback ?? bossMemoryResult.message });
      return;
    }
    const reqId = `office-save-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    requestIdRef.current = reqId;
    const listener = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "settings_save_response" && msg.requestId === reqId) {
          saveGuard.finish();
          if (msg.ok) {
            if (name.trim() && name.trim() !== username) onSaveUsername(name.trim());
            onClose();
          } else {
            setStatus({ kind: "error", message: msg.error || { key: "settingsUi.saveFailed" } });
          }
        }
      } catch {}
    };
    saveGuard.listen(listener);
    send({
      type: "update_office_settings",
      requestId: reqId,
      prompt: text.trim() ? text : null,
      envFile: envFile.trim() || null,
      experimental: { browserPanel },
      receptionistAgentId: receptionistAgentId || null,
      version: settingsVersion,
    });
  }

  // Place cursor at end of text on mount
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta && settingsVersion) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, [settingsVersion]);

  const requestClose = () => {
    if (!saveGuard.pending()) discardPrompt.requestLeave(onClose);
  };

  return (
    <Modal onClose={requestClose}>
      <fieldset disabled={saving || !settingsVersion} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{t("settingsUi.officeTitle")}</h3>

        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 18, marginBottom: 5 }}>{t("settingsUi.bossTitle")}</label>
        <input aria-label={t("settingsUi.bossTitle")} value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />

        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
          {t("settings.profile.envFilePath")} <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>{t("settingsUi.absoluteOptional")}</span>
        </label>
        <input
          aria-label={t("settings.profile.envFilePath")}
          value={envFile}
          onChange={(e) => {
            setEnvFile(e.target.value);
            setStatus({ kind: "idle" });
          }}
          placeholder="/home/you/.secrets/office.env"
          style={inputStyle}
        />
        {!settingsVersion && status.kind === "idle" && (
          <p role="status" style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {t("common.loading")}
          </p>
        )}
        <ValidationLine status={status} />

        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
          {t("settingsUi.rules")} <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>{t("settingsUi.rulesScope")}</span>
        </label>
        <ExpandableTextarea
          textareaRef={textareaRef}
          title={t("settingsUi.officeRules")}
          hint={t("settingsUi.rulesHint")}
          value={text}
          onChange={setText}
          placeholder={t("settingsUi.rulesPlaceholder")}
          rows={8}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "3px 0 0" }}>{t("settingsUi.nextConversation")}</p>

        {isOwner && (
          <>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
              {t("settingsUi.receptionist")} <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>{t("common.optional")}</span>
            </label>
            <select aria-label={t("settingsUi.receptionist")} value={receptionistAgentId} onChange={(e) => setReceptionistAgentId(e.target.value)} style={inputStyle}>
              <option value="">{t("settingsUi.noReceptionist")}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "3px 0 0" }}>{t("settingsUi.receptionistHint")}</p>
          </>
        )}

        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
          {t("settingsUi.memory")}{" "}
          <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>
            {t("settingsUi.officeMemorySize", { size: officeMemory.size.toLocaleString(language), cap: officeMemory.cap?.toLocaleString(language) ?? "…" })}
          </span>
        </label>
        <ExpandableTextarea
          title={t("settingsUi.officeMemory")}
          hint={t("settingsUi.memoryHint")}
          value={officeMemory.memory}
          onChange={officeMemory.setMemory}
          rows={5}
          style={{ ...inputStyle, resize: "vertical" }}
          disabled={!officeMemory.loaded}
        />
        <MemoryLoadFeedback editor={officeMemory} title={t("settingsUi.officeMemory")} />

        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>
          {t("settingsUi.myMemory")}{" "}
          <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>
            {t("settingsUi.myMemorySize", { size: bossMemory.size.toLocaleString(language), cap: bossMemory.cap?.toLocaleString(language) ?? "…" })}
          </span>
        </label>
        <ExpandableTextarea
          title={t("settingsUi.myMemory")}
          hint={t("settingsUi.memoryHint")}
          value={bossMemory.memory}
          onChange={bossMemory.setMemory}
          rows={5}
          style={{ ...inputStyle, resize: "vertical" }}
          disabled={!bossMemory.loaded}
        />
        <MemoryLoadFeedback editor={bossMemory} title={t("settingsUi.myMemory")} />

        <h4 style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 14, marginBottom: 5 }}>{t("settingsUi.experimental")}</h4>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginTop: 4,
            fontSize: 12,
            color: "var(--text-primary)",
            cursor: "pointer",
          }}
        >
          <input type="checkbox" checked={browserPanel} onChange={(e) => setBrowserPanel(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            <span style={{ fontWeight: 600 }}>{t("settingsUi.agentBrowser")}</span>
            <span style={{ display: "block", fontSize: 10, color: "var(--text-ghost)", marginTop: 2, fontWeight: 400 }}>{t("settingsUi.agentBrowserHint")}</span>
          </span>
        </label>
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
const cancelBtnStyle: React.CSSProperties = dialogCancelBtn;
const saveBtnStyle: React.CSSProperties = dialogSaveBtn;
