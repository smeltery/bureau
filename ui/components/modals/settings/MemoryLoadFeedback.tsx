import type { MemoryEditor } from "../../../hooks/useMemoryEditor.ts";
import { settingsFailureText } from "../../../hooks/settings/feedback.ts";
import { useI18n } from "../../../i18n.tsx";
import { dialogCancelBtn } from "../dialog-styles.ts";

export function MemoryLoadFeedback({ editor, title }: { editor: MemoryEditor; title: string }) {
  const { t } = useI18n();
  if (editor.loaded) return null;
  return (
    <div style={{ marginTop: 6, fontSize: 11 }}>
      <p role={editor.loadError ? "alert" : "status"} style={{ color: editor.loadError ? "var(--red)" : "var(--text-muted)", margin: "0 0 6px" }}>
        {editor.loadError ? settingsFailureText(editor.loadError, t) : t("common.loading")}
      </p>
      {editor.loadError && (
        <button type="button" aria-label={`${t("common.retry")} · ${title}`} onClick={editor.retryLoad} style={dialogCancelBtn}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}
