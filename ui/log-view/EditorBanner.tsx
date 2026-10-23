import type { Translator } from "../../shared/i18n/translate.ts";
import { useI18n } from "../i18n.tsx";
import type { Tab, EditorOpenError } from "./editor-model.ts";

export function EditorBanner({
  activeTab,
  pendingError,
  onOverwrite,
  onReload,
  onRecreate,
  onCloseTab,
  onDismissBanner,
  onDismissError,
}: {
  activeTab: Tab | null;
  pendingError: EditorOpenError | null;
  onOverwrite: () => void;
  onReload: () => void;
  onRecreate: () => void;
  onCloseTab: () => void;
  onDismissBanner: () => void;
  onDismissError: () => void;
}) {
  const translator = useI18n();
  const { t } = translator;
  return (
    <>
      {activeTab?.banner && (
        <div
          style={{
            padding: "6px 12px",
            background: activeTab.banner.kind === "save_error" ? "var(--red-bg)" : "var(--orange-bg)",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            color: activeTab.banner.kind === "save_error" ? "var(--red)" : "var(--orange)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {activeTab.banner.kind === "stale" && (
            <>
              <span style={{ flex: 1 }}>{t("editor.stale")}</span>
              <button onClick={onOverwrite} style={bannerBtn("var(--orange)")}>
                {t("editor.overwrite")}
              </button>
              <button onClick={onReload} style={bannerBtn("var(--text-secondary)")}>
                {t("editor.reload")}
              </button>
            </>
          )}
          {activeTab.banner.kind === "external" && (
            <>
              <span style={{ flex: 1 }}>{t("editor.external")}</span>
              <button onClick={onReload} style={bannerBtn("var(--orange)")}>
                {t("editor.reload")}
              </button>
              <button onClick={onDismissBanner} style={bannerBtn("var(--text-secondary)")}>
                {t("editor.dismiss")}
              </button>
            </>
          )}
          {activeTab.banner.kind === "deleted" && (
            <>
              <span style={{ flex: 1 }}>{t("editor.deleted")}</span>
              <button onClick={onRecreate} style={bannerBtn("var(--orange)")}>
                {t("editor.recreate")}
              </button>
              <button onClick={onCloseTab} style={bannerBtn("var(--text-secondary)")}>
                {t("editor.closeTab")}
              </button>
            </>
          )}
          {activeTab.banner.kind === "save_error" && (
            <>
              <span style={{ flex: 1 }}>{activeTab.banner.message ? t("editor.saveFailed", { error: activeTab.banner.message }) : t("editor.saveFailedUnknown")}</span>
              <button onClick={onDismissBanner} style={bannerBtn("var(--red)")}>
                {t("editor.dismiss")}
              </button>
            </>
          )}
        </div>
      )}

      {pendingError && (
        <div
          style={{
            padding: "6px 12px",
            background: "var(--red-bg)",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--red)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ flex: 1 }}>
            {pendingError.path}: {describeOpenError(pendingError, translator)}
          </span>
          <button onClick={onDismissError} style={bannerBtn("var(--red)")}>
            {t("editor.dismiss")}
          </button>
        </div>
      )}
    </>
  );
}

function bannerBtn(color: string): React.CSSProperties {
  return {
    padding: "2px 10px",
    borderRadius: 4,
    border: `1px solid ${color}`,
    background: "transparent",
    color,
    fontSize: 11,
    fontFamily: "'JetBrains Mono',monospace",
    cursor: "pointer",
  };
}

function describeOpenError(error: EditorOpenError, { t, language }: Translator): string {
  switch (error.reason) {
    case "not_found":
      return t("editor.notFound");
    case "not_file":
      return t("editor.notFile");
    case "binary":
      return t("editor.binary");
    case "too_large":
      return typeof error.size === "number"
        ? t("editor.tooLarge", { size: (error.size / 1024).toLocaleString(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
        : t("editor.tooLargeUnknown");
    case "io_error":
      return t("editor.ioError", { error: error.message ?? t("editor.unknownError") });
    case "bad_path":
      return t("editor.badPath");
  }
}
