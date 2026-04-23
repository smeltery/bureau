import { useEffect } from "react";
import { useAppState } from "../../store.tsx";

/**
 * Shared modal shell used by OfficePromptModal, RoomSettingsModal,
 * UpdateModal, and other overlays that follow the "floating card on a
 * blurred backdrop" pattern.
 *
 * Handles:
 *   - Fixed-position backdrop with blur
 *   - Click-outside-to-close
 *   - Escape key handler (captured, so per-modal Escape handlers inside
 *     children still run first if they stopPropagation)
 *   - Mobile top-align + scroll vs desktop centered layout
 *   - Consistent card chrome: bg-overlay, border, radius, padding, shadow
 *
 * Callers still control the content + width. UsernameModal and
 * EditAgentDialog don't use this because their card styling diverges
 * (smaller / full-height, respectively).
 */
export function Modal({
  onClose,
  width = 440,
  allowBackdropClose = true,
  children,
}: {
  onClose: () => void;
  width?: number;
  /** If false, click-outside is a no-op (Esc still fires). */
  allowBackdropClose?: boolean;
  children: React.ReactNode;
}) {
  const { isMobile } = useAppState();

  // Capture-phase so this fires before any page-level Esc handler, matching
  // the original per-modal behaviour.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  return (
    <div
      onMouseDown={allowBackdropClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: isMobile ? "flex-start" : "center",
        justifyContent: "center",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          background: "var(--bg-overlay)",
          backdropFilter: "blur(16px)",
          border: "1px solid var(--border-light)",
          borderRadius: 16,
          padding: "24px 28px",
          marginTop: isMobile ? "env(safe-area-inset-top, 16px)" : undefined,
          marginBottom: isMobile ? 16 : undefined,
          width: isMobile ? "calc(100% - 32px)" : width,
          maxWidth: isMobile ? "100%" : undefined,
          boxShadow: "0 20px 60px var(--shadow-heavy)",
          animation: "hudIn 0.2s ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}
