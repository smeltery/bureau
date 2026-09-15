import type { ReactElement } from "react";
import { effectiveRoomSkin, type RoomSkin } from "../../../shared/types.ts";
import { useAppState, useTheme } from "../../store.tsx";
import type { ThemeMode } from "../../themes/index.ts";
import { hospitalSceneVars } from "./hospital/palette.ts";
import { HospitalProps } from "./hospital/props.tsx";
import { HospitalWalls } from "./hospital/walls.tsx";

// A room skin is a LOOK: theme variable overrides plus optional wall/floor
// layers. Desks, characters, pets, and status lights stay the same under every
// skin — no branches in Floor.tsx.
export interface RoomSkinModule {
  vars(mode: ThemeMode): Record<string, string>;
  Walls?: () => ReactElement;
  Props?: () => ReactElement;
}

export const ROOM_SKIN_MODULES: Record<RoomSkin, RoomSkinModule> = {
  office: { vars: () => ({}) },
  hospital: {
    vars: hospitalSceneVars,
    Walls: HospitalWalls,
    Props: HospitalProps,
  },
};

export function useCurrentRoomSkin(): RoomSkin {
  const { currentRoom, rooms } = useAppState();
  return effectiveRoomSkin(rooms[currentRoom]);
}

export function useRoomSkinVars(): Record<string, string> {
  const skin = useCurrentRoomSkin();
  const { mode } = useTheme();
  return ROOM_SKIN_MODULES[skin].vars(mode);
}

export function SkinWalls() {
  const Layer = ROOM_SKIN_MODULES[useCurrentRoomSkin()].Walls;
  return Layer ? <Layer /> : null;
}

export function SkinProps({ skin }: { skin: RoomSkin }) {
  const Layer = ROOM_SKIN_MODULES[skin].Props;
  return Layer ? <Layer /> : null;
}
