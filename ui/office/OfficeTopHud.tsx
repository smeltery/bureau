import { useState } from "react";
import { ThemePicker } from "../components/ThemePicker.tsx";
import { MobileHeader, type RoomCounts } from "../components/overlays/MobileHeader.tsx";
import { useDispatch, useTheme } from "../store.tsx";
import { DesktopOfficeHeader } from "./OfficeHeader.tsx";
import { RoomTabBar } from "./RoomTabBar.tsx";

export function OfficeTopHud({
  counts,
  embed,
  isMobile,
  username,
  updateAvailable,
  onEditUsername,
  onOpenDeviceSettings,
  onEditOfficePrompt,
  onEditRoomSettings,
  onOpenTasks,
  onOpenCronjobs,
  onOpenPlugins,
  onOpenUpdate,
}: {
  counts: RoomCounts;
  embed: boolean;
  isMobile: boolean;
  username: string;
  updateAvailable: boolean;
  onEditUsername: () => void;
  onOpenDeviceSettings: () => void;
  onEditOfficePrompt: () => void;
  onEditRoomSettings?: () => void;
  onOpenTasks: () => void;
  onOpenCronjobs?: () => void;
  onOpenPlugins?: () => void;
  onOpenUpdate: () => void;
}) {
  const dispatch = useDispatch();
  const { mode } = useTheme();
  const [themePickerOpen, setThemePickerOpen] = useState(false);

  if (embed) return null;

  return (
    <>
      {isMobile ? (
        <MobileHeader
          viewMode="office"
          onToggleView={() => dispatch({ type: "toggle_mobile_view" })}
          counts={counts}
          onOpenTasks={onOpenTasks}
          onEditUsername={onEditUsername}
          onOpenDeviceSettings={onOpenDeviceSettings}
          onEditOfficePrompt={onEditOfficePrompt}
          onEditRoomSettings={onEditRoomSettings}
          updateAvailable={updateAvailable}
          onOpenUpdate={onOpenUpdate}
        />
      ) : (
        <DesktopOfficeHeader
          counts={counts}
          mode={mode}
          username={username}
          updateAvailable={updateAvailable}
          onOpenTasks={onOpenTasks}
          onOpenCronjobs={onOpenCronjobs}
          onOpenPlugins={onOpenPlugins}
          onEditUsername={onEditUsername}
          onOpenDeviceSettings={onOpenDeviceSettings}
          onEditOfficePrompt={onEditOfficePrompt}
          onEditRoomSettings={onEditRoomSettings}
          onOpenUpdate={onOpenUpdate}
          onOpenTheme={() => setThemePickerOpen(true)}
        />
      )}
      <RoomTabBar />
      <ThemePicker open={themePickerOpen} onClose={() => setThemePickerOpen(false)} />
    </>
  );
}
