import { useState } from "react";
import { CopyButton } from "../../components/controls/CopyButton.tsx";
import { MoonIcon, PersonIcon, SunIcon } from "../../components/controls/Icons.tsx";
import { ThemePicker } from "../../components/ThemePicker.tsx";
import { useFeatures, useTheme } from "../../store.tsx";

export function HeaderActions({
  logs,
  onOpenTasks,
  showAvatar,
  toggleAvatar,
  terminalOpen,
  setTerminalOpen,
  editorOpen,
  setEditorOpen,
  getConversationText,
}: {
  logs: unknown[];
  onOpenTasks?: () => void;
  showAvatar: boolean;
  toggleAvatar: () => void;
  terminalOpen: boolean;
  setTerminalOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  editorOpen: boolean;
  setEditorOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  getConversationText: () => string;
}) {
  const { mode } = useTheme();
  const features = useFeatures();
  const [themePickerOpen, setThemePickerOpen] = useState(false);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", flexShrink: 0, marginLeft: 12 }}>
      {onOpenTasks && (
        <button
          onClick={onOpenTasks}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--border-medium)",
            background: "var(--btn-surface)",
            color: "var(--text-dim)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Tasks
        </button>
      )}
      {logs.length > 0 && <CopyButton getText={getConversationText} />}
      <button
        onClick={toggleAvatar}
        title={showAvatar ? "Hide agent avatar" : "Show agent avatar"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "4px 8px",
          borderRadius: 6,
          border: "1px solid var(--border-medium)",
          background: "var(--btn-surface)",
          color: "var(--text-dim)",
          cursor: "pointer",
          opacity: showAvatar ? 1 : 0.35,
          transition: "opacity 0.2s",
        }}
      >
        <PersonIcon />
      </button>
      <button
        onClick={() => setThemePickerOpen(true)}
        title="Change theme"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "4px 8px",
          borderRadius: 6,
          border: "1px solid var(--border-medium)",
          background: "var(--btn-surface)",
          color: "var(--text-dim)",
          cursor: "pointer",
        }}
      >
        {mode === "dark" ? <MoonIcon /> : <SunIcon />}
      </button>
      <ThemePicker open={themePickerOpen} onClose={() => setThemePickerOpen(false)} />
      {features.editor && (
        <button
          onClick={() => setEditorOpen((prev) => !prev)}
          title={editorOpen ? "Close editor" : "Open editor"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            borderRadius: 6,
            border: `1px solid ${editorOpen ? "var(--green-border)" : "var(--border-medium)"}`,
            background: editorOpen ? "var(--green-bg)" : "var(--btn-surface)",
            color: editorOpen ? "var(--green)" : "var(--text-dim)",
            fontSize: 12,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>Ed</span>
        </button>
      )}
      {features.terminal && (
        <button
          onClick={() => setTerminalOpen((prev) => !prev)}
          title={terminalOpen ? "Close terminal (Ctrl+`)" : "Open terminal (Ctrl+`)"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            borderRadius: 6,
            border: `1px solid ${terminalOpen ? "var(--green-border)" : "var(--border-medium)"}`,
            background: terminalOpen ? "var(--green-bg)" : "var(--btn-surface)",
            color: terminalOpen ? "var(--green)" : "var(--text-dim)",
            fontSize: 12,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>&gt;_</span>
        </button>
      )}
    </div>
  );
}
