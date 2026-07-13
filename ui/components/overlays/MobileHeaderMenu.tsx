import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../store.tsx";
import { SunIcon, MoonIcon } from "../controls/Icons.tsx";
import { ThemePicker } from "../ThemePicker.tsx";

const DOOR_ICON = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" style={{ display: "block" }}>
    <path d="M3.5 13.5V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v10.5" />
    <path d="M2.5 13.5h11" />
    <circle cx="10.5" cy="8.25" r="0.7" fill="currentColor" stroke="none" />
  </svg>
);

const BUILDING_ICON = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" style={{ display: "block" }}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
    <path d="M5 5.5h1.5M9.5 5.5H11M5 8h1.5M9.5 8H11M5 10.5h1.5M9.5 10.5H11" />
  </svg>
);

const DEVICE_ICON = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" style={{ display: "block" }}>
    <rect x="5" y="1.5" width="6" height="13" rx="1.2" />
    <path d="M7.4 12.2h1.2" />
  </svg>
);

const TASKS_ICON = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" style={{ display: "block" }}>
    <path d="M3 4.5l1.3 1.3L6.8 3.3" />
    <path d="M3 8.5l1.3 1.3L6.8 7.3" />
    <path d="M3 12.5l1.3 1.3L6.8 11.3" />
    <path d="M9 4.5h4.5M9 8.5h4.5M9 12.5h4.5" />
  </svg>
);

export function MobileHeaderMenu({
  onOpenTasks,
  onEditUsername,
  onOpenDeviceSettings,
  onEditOfficePrompt,
  onEditRoomSettings,
}: {
  onOpenTasks: () => void;
  onEditUsername?: () => void;
  onOpenDeviceSettings?: () => void;
  onEditOfficePrompt: () => void;
  onEditRoomSettings?: () => void;
}) {
  const { mode } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <>
      <div style={{ position: "relative" }} ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          style={{
            background: "var(--btn-surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "3px 8px",
            color: "var(--text-dim)",
            fontSize: 16,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          &#8943;
        </button>
        {menuOpen && (
          <div
            style={{
              position: "fixed",
              top: menuRef.current ? menuRef.current.getBoundingClientRect().bottom + 6 : 0,
              right: 12,
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "0 8px 24px var(--shadow-heavy)",
              minWidth: 180,
              zIndex: 1000,
              overflow: "hidden",
            }}
          >
            {[
              { icon: TASKS_ICON, label: "Tasks", action: onOpenTasks },
              ...(onEditUsername ? [{ icon: BUILDING_ICON, label: "User settings", action: onEditUsername }] : []),
              ...(onOpenDeviceSettings ? [{ icon: DEVICE_ICON, label: "Device settings", action: onOpenDeviceSettings }] : []),
              { icon: BUILDING_ICON, label: "Office settings", action: onEditOfficePrompt },
              ...(onEditRoomSettings ? [{ icon: DOOR_ICON, label: "Room settings", action: onEditRoomSettings }] : []),
              { icon: mode === "dark" ? <MoonIcon size={15} /> : <SunIcon size={15} />, label: "Theme", action: () => setThemePickerOpen(true) },
            ].map((item, i) => (
              <button
                key={i}
                onClick={() => {
                  setMenuOpen(false);
                  item.action();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "12px 16px",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-primary)",
                  fontSize: 14,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ width: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <ThemePicker open={themePickerOpen} onClose={() => setThemePickerOpen(false)} />
    </>
  );
}
