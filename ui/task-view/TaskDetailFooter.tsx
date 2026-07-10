export function TaskDetailFooter({
  confirmDelete,
  confirmDiscard,
  fullScreen,
  mode,
  title,
  onCancelDiscard,
  onClose,
  onDelete,
  onSave,
  setConfirmDelete,
}: {
  confirmDelete: boolean;
  confirmDiscard: boolean;
  fullScreen: boolean;
  mode: "edit" | "create";
  title: string;
  onCancelDiscard: () => void;
  onClose: () => void;
  onDelete: () => void;
  onSave: () => void;
  setConfirmDelete: (value: boolean) => void;
}) {
  const canSave = !!title.trim();

  return (
    <div
      style={{
        padding: fullScreen ? "12px 20px max(12px, env(safe-area-inset-bottom, 0px))" : "12px 24px 20px",
        borderTop: "1px solid var(--border-subtle)",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {confirmDiscard && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", flex: 1 }}>Discard unsaved changes?</span>
          <button
            onClick={onClose}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--red)",
              background: "var(--red)",
              color: "var(--bg-base)",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Discard
          </button>
          <button
            onClick={onCancelDiscard}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-primary)",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onSave}
          disabled={!canSave}
          style={{
            flex: 1,
            padding: "9px 0",
            borderRadius: 8,
            border: "none",
            background: canSave ? "var(--accent)" : "var(--bg-subtle)",
            color: canSave ? "var(--bg-base)" : "var(--text-muted)",
            fontSize: 12,
            fontWeight: 600,
            cursor: canSave ? "pointer" : "default",
          }}
        >
          {mode === "create" ? "Create" : "Save"}
        </button>
        {mode === "edit" && (
          <button
            onClick={onDelete}
            onBlur={() => setConfirmDelete(false)}
            style={{
              padding: "9px 14px",
              borderRadius: 8,
              border: `1px solid ${confirmDelete ? "var(--red)" : "var(--border)"}`,
              background: confirmDelete ? "var(--red)" : "transparent",
              color: confirmDelete ? "var(--bg-base)" : "var(--red)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {confirmDelete ? "Confirm?" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
}
