import { dialogLabel } from "../components/modals/dialog-styles.ts";
export function headerStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: isMobile ? "0 12px" : "0 20px",
    paddingTop: isMobile ? "env(safe-area-inset-top, 0px)" : undefined,
    minHeight: 44,
    background: "var(--bg-hud)",
    backdropFilter: "blur(16px)",
    borderBottom: "1px solid var(--border-subtle)",
    flexShrink: 0,
    zIndex: 500,
  };
}

export function sidebarStyle(isMobile: boolean): React.CSSProperties {
  return {
    width: isMobile ? "100%" : 320,
    maxWidth: "100%",
    borderRight: isMobile ? "none" : "1px solid var(--border-subtle)",
    overflowY: "auto",
    padding: isMobile ? "14px 12px" : "18px 20px",
  };
}

export function detailStyle(isMobile: boolean): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    overflowY: "auto",
    padding: isMobile ? "14px 12px" : "20px 28px",
  };
}

export const backBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  fontSize: 18,
  cursor: "pointer",
  padding: "2px 8px",
};
export const sidebarLabel: React.CSSProperties = { ...dialogLabel, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" };
export const rowButton: React.CSSProperties = {
  width: "100%",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  border: "1px solid var(--border-subtle)",
  borderRadius: 8,
  padding: "8px 10px",
  marginBottom: 6,
  background: "transparent",
  color: "var(--text-primary)",
  textAlign: "left",
  fontSize: 12,
};

export const smallBtn: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--btn-surface)",
  color: "var(--text-dim)",
  borderRadius: 7,
  padding: "5px 9px",
  fontSize: 11,
  cursor: "pointer",
};
