import type { Tab } from "./editor-model.ts";

export function EditorBanner({
  activeTab,
  pendingError,
  onOverwrite,
  onReload,
  onDismissBanner,
  onDismissError,
}: {
  activeTab: Tab | null;
  pendingError: string | null;
  onOverwrite: () => void;
  onReload: () => void;
  onDismissBanner: () => void;
  onDismissError: () => void;
}) {
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
              <span style={{ flex: 1 }}>File changed on disk since you opened it.</span>
              <button onClick={onOverwrite} style={bannerBtn("var(--orange)")}>
                Overwrite
              </button>
              <button onClick={onReload} style={bannerBtn("var(--text-secondary)")}>
                Reload
              </button>
            </>
          )}
          {activeTab.banner.kind === "external" && (
            <>
              <span style={{ flex: 1 }}>File changed externally — your edits will be lost if you reload.</span>
              <button onClick={onReload} style={bannerBtn("var(--orange)")}>
                Reload
              </button>
              <button onClick={onDismissBanner} style={bannerBtn("var(--text-secondary)")}>
                Dismiss
              </button>
            </>
          )}
          {activeTab.banner.kind === "save_error" && (
            <>
              <span style={{ flex: 1 }}>Save failed: {activeTab.banner.message}</span>
              <button onClick={onDismissBanner} style={bannerBtn("var(--red)")}>
                Dismiss
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
          <span style={{ flex: 1 }}>{pendingError}</span>
          <button onClick={onDismissError} style={bannerBtn("var(--red)")}>
            Dismiss
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
