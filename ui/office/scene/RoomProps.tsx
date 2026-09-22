import type { ReactElement } from "react";
import { SCENE_W, SCENE_H, VB_X, VB_Y } from "../grid.ts";
import { useAppState } from "../../store.tsx";
import { DEFAULT_ROOM_PET, effectiveRoomSkin, paletteForPet, type PetPalette, type PetSpecies, type RoomPet } from "../../../shared/types.ts";
import { ROOM_SKIN_MODULES, SkinProps } from "../skins/index.tsx";

function Cat({ p }: { p: PetPalette }) {
  return (
    <>
      <ellipse cx="0" cy="0" rx="16" ry="9" fill={p.coat}>
        <animate attributeName="ry" values="9;9.5;9" dur="3s" repeatCount="indefinite" />
      </ellipse>
      <ellipse cx="0" cy="0" rx="16" ry="9" fill="url(#pet-volume)" />
      <path d="M-8 -4 Q-4 -7 0 -4" stroke={p.mark} strokeWidth="1" fill="none" />
      <path d="M2 -5 Q6 -8 10 -5" stroke={p.mark} strokeWidth="1" fill="none" />
      <path d="M14 2 Q22 -2 20 -10 Q18 -16 12 -14" stroke={p.coat} strokeWidth="3.5" fill="none" strokeLinecap="round">
        <animate attributeName="d" values="M14 2 Q22 -2 20 -10 Q18 -16 12 -14;M14 2 Q24 -4 22 -12 Q19 -18 13 -15;M14 2 Q22 -2 20 -10 Q18 -16 12 -14" dur="4s" repeatCount="indefinite" />
      </path>
      <path d="M14 2 Q22 -2 20 -10 Q18 -16 12 -14" stroke={p.mark} strokeWidth="1" fill="none" strokeLinecap="round">
        <animate attributeName="d" values="M14 2 Q22 -2 20 -10 Q18 -16 12 -14;M14 2 Q24 -4 22 -12 Q19 -18 13 -15;M14 2 Q22 -2 20 -10 Q18 -16 12 -14" dur="4s" repeatCount="indefinite" />
      </path>
      <ellipse cx="-12" cy="-2" rx="8" ry="7" fill={p.coat} />
      <ellipse cx="-12" cy="-2" rx="8" ry="7" fill="url(#pet-volume)" />
      <path d="M-18 -7 L-16 -14 L-12 -8 Z" fill={p.coat} />
      <path d="M-12 -8 L-8 -14 L-6 -7 Z" fill={p.coat} />
      <path d="M-17 -7 L-15.5 -12 L-13 -8 Z" fill={p.inner} />
      <path d="M-11 -8 L-8.5 -12 L-7 -7 Z" fill={p.inner} />
      <path d="M-16 -2 Q-14.5 -4 -13 -2" stroke={p.line} strokeWidth="0.8" fill="none" />
      <path d="M-11 -3 Q-9.5 -5 -8 -3" stroke={p.line} strokeWidth="0.8" fill="none" />
      <ellipse cx="-12" cy="0" rx="1" ry="0.7" fill={p.nose} />
      <line x1="-18" y1="-1" x2="-23" y2="-3" stroke={p.line} strokeWidth="0.3" />
      <line x1="-18" y1="1" x2="-23" y2="1" stroke={p.line} strokeWidth="0.3" />
      <line x1="-6" y1="-1" x2="-1" y2="-3" stroke={p.line} strokeWidth="0.3" />
      <line x1="-6" y1="1" x2="-1" y2="1" stroke={p.line} strokeWidth="0.3" />
    </>
  );
}

function Dog({ p }: { p: PetPalette }) {
  return (
    <>
      <g>
        <animateTransform attributeName="transform" type="rotate" values="-6 9 3;6 9 3;-6 9 3" dur="1.7s" repeatCount="indefinite" />
        <path d="M9 3.4 Q23 5 25.6 -4 Q26.6 -10 22.2 -12.2" stroke={p.mark} strokeWidth="5.2" fill="none" strokeLinecap="round" />
        <path d="M9 2 Q23 3.4 25 -5 Q26 -10.6 21.8 -12.6" stroke={p.coat} strokeWidth="4.2" fill="none" strokeLinecap="round" />
        <path d="M13 1.2 Q22 2.2 24.2 -5" stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <circle cx="21.8" cy="-12.6" r="2.9" fill={p.coat} />
        <circle cx="21" cy="-13.4" r="1.5" fill="#FFFFFF" opacity="0.18" />
      </g>
      <ellipse cx="0" cy="0" rx="17" ry="9.5" fill={p.coat}>
        <animate attributeName="ry" values="9.5;10.1;9.5" dur="3.4s" repeatCount="indefinite" />
      </ellipse>
      <path d="M-5 -8 Q4 -11 13 -5 Q4 -2 -5 -8 Z" fill={p.mark} opacity="0.9" />
      <ellipse cx="6" cy="3" rx="5" ry="2.6" fill={p.mark} opacity="0.5" />
      <ellipse cx="0" cy="0" rx="17" ry="9.5" fill="url(#pet-volume)" />
      <ellipse cx="-14" cy="-3" rx="8.5" ry="7.5" fill={p.coat} />
      <ellipse cx="-14" cy="-3" rx="8.5" ry="7.5" fill="url(#pet-volume)" />
      <ellipse cx="-14" cy="1.5" rx="5.6" ry="4" fill={p.inner} />
      <ellipse cx="-14" cy="1.5" rx="5.6" ry="4" fill="url(#pet-volume)" />
      <path d="M-19.5 -8.5 Q-27 -7.5 -26 3 Q-25 10.5 -20 8.5 Q-18 1.5 -19 -4.5 Z" fill={p.mark} stroke={p.line} strokeWidth="0.35" strokeOpacity="0.3" />
      <path d="M-8.5 -8.5 Q-1 -7.5 -2 3 Q-3 10.5 -8 8.5 Q-10 1.5 -9 -4.5 Z" fill={p.mark} stroke={p.line} strokeWidth="0.35" strokeOpacity="0.3" />
      <path d="M-18.6 -4.4 Q-17 -6.6 -15.4 -4.4" stroke={p.line} strokeWidth="0.9" fill="none" />
      <path d="M-12.6 -4.4 Q-11 -6.6 -9.4 -4.4" stroke={p.line} strokeWidth="0.9" fill="none" />
      <circle cx="-17" cy="-7.8" r="0.9" fill={p.mark} opacity="0.7" />
      <circle cx="-11" cy="-7.8" r="0.9" fill={p.mark} opacity="0.7" />
      <ellipse cx="-14" cy="-0.4" rx="2.3" ry="1.7" fill={p.nose} />
      <path d="M-14 1.3 L-14 2.4" stroke={p.nose} strokeWidth="0.5" />
      {p.tongue ? (
        <>
          <path d="M-15 3 Q-15.3 6.5 -14 6.5 Q-12.7 6.5 -13 3 Z" fill="#C4838C" />
          <path d="M-14 4.1 L-14 5.9" stroke="#A66C76" strokeWidth="0.35" />
        </>
      ) : (
        <path d="M-16.6 3.4 Q-14 4.9 -11.4 3.4" stroke={p.line} strokeWidth="0.5" fill="none" opacity="0.75" />
      )}
    </>
  );
}

function Rabbit({ p }: { p: PetPalette }) {
  return (
    <>
      <circle cx="14" cy="-2" r="4.2" fill="#F6F1E8" />
      <circle cx="12.6" cy="-3" r="2.2" fill="#FFFFFF" opacity="0.55" />
      <ellipse cx="0" cy="0" rx="15" ry="9.5" fill={p.coat}>
        <animate attributeName="ry" values="9.5;10.2;9.5" dur="2.6s" repeatCount="indefinite" />
      </ellipse>
      <ellipse cx="0" cy="0" rx="15" ry="9.5" fill="url(#pet-volume)" />
      <path d="M-2 -7 Q5 -9 11 -5 Q4 -3 -2 -7 Z" fill={p.mark} opacity="0.55" />
      <path d="M-14 -8 Q-20 -18 -16 -24 Q-11 -21 -11 -9 Z" fill={p.coat} />
      <path d="M-14.5 -10 Q-18 -18 -15.5 -22 Q-13 -19 -12.5 -10 Z" fill={p.inner} opacity="0.7" />
      <ellipse cx="-11" cy="-3" rx="7" ry="6.5" fill={p.coat} />
      <ellipse cx="-11" cy="-3" rx="7" ry="6.5" fill="url(#pet-volume)" />
      <g>
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="0 -9.5 -8;0 -9.5 -8;10 -9.5 -8;-3 -9.5 -8;0 -9.5 -8;0 -9.5 -8"
          keyTimes="0;0.72;0.79;0.85;0.91;1"
          dur="5s"
          repeatCount="indefinite"
        />
        <path d="M-8 -8 Q-2 -18 -6 -24 Q-11 -21 -11 -9 Z" fill={p.coat} />
        <path d="M-7.5 -10 Q-4 -18 -6.5 -22 Q-9 -19 -9.5 -10 Z" fill={p.inner} opacity="0.7" />
      </g>
      <path d="M-14.6 -3.4 Q-13.3 -5.3 -12 -3.4" stroke={p.line} strokeWidth="0.85" fill="none" />
      <path d="M-10 -3.4 Q-8.7 -5.3 -7.4 -3.4" stroke={p.line} strokeWidth="0.85" fill="none" />
      <path d="M-12.3 0.5 L-11 -0.9 L-9.7 0.5 Z" fill={p.nose} />
      <path d="M-11 0.5 L-11 1.7" stroke={p.nose} strokeWidth="0.45" />
      <path d="M-12.9 2.6 Q-11 1.5 -11 1.7 Q-11 1.5 -9.1 2.6" stroke={p.nose} strokeWidth="0.45" fill="none" />
      <g stroke={p.line} strokeWidth="0.4" strokeOpacity="0.8">
        <line x1="-13.4" y1="0.8" x2="-19.4" y2="-0.6" />
        <line x1="-13.4" y1="1.8" x2="-19.4" y2="2.2" />
        <line x1="-8.6" y1="0.8" x2="-2.6" y2="-0.6" />
        <line x1="-8.6" y1="1.8" x2="-2.6" y2="2.2" />
      </g>
    </>
  );
}

function Tortoise({ p }: { p: PetPalette }) {
  return (
    <>
      <rect x="6" y="1" width="7" height="5.5" rx="2.6" fill={p.inner} />
      <path d="M15 -1 L20 0 L15 2 Z" fill={p.inner} />
      <path d="M-16 1 A16 12 0 0 1 16 1 Z" fill={p.coat}>
        <animate attributeName="d" values="M-16 1 A16 12 0 0 1 16 1 Z;M-16 1 A16 12.8 0 0 1 16 1 Z;M-16 1 A16 12 0 0 1 16 1 Z" dur="4.2s" repeatCount="indefinite" />
      </path>
      <path d="M-16 1 A16 12 0 0 1 16 1 Z" fill="url(#pet-volume)">
        <animate attributeName="d" values="M-16 1 A16 12 0 0 1 16 1 Z;M-16 1 A16 12.8 0 0 1 16 1 Z;M-16 1 A16 12 0 0 1 16 1 Z" dur="4.2s" repeatCount="indefinite" />
      </path>
      <g stroke={p.mark} strokeWidth="0.85" fill="none" strokeOpacity="0.9" strokeLinecap="round">
        <path d="M-12.4 -2.6 Q0 -13.6 12.4 -2.6" />
        <path d="M-15.4 0.4 Q0 -7 15.4 0.4" />
        <path d="M-4.6 -10.4 L-4.6 -7.4" />
        <path d="M4.6 -10.4 L4.6 -7.4" />
        <path d="M-8.6 -5.5 L-8.9 -2.2" />
        <path d="M0 -8.1 L0 -3.3" />
        <path d="M8.6 -5.5 L8.9 -2.2" />
        <path d="M-12.4 -0.9 L-13 0.7" />
        <path d="M-6.4 -2.7 L-6.6 0.9" />
        <path d="M0 -3.3 L0 1" />
        <path d="M6.4 -2.7 L6.6 0.9" />
        <path d="M12.4 -0.9 L13 0.7" />
      </g>
      <ellipse cx="0" cy="1" rx="16.6" ry="2.6" fill={p.mark} />
      <rect x="-13" y="1" width="7.5" height="5.5" rx="2.6" fill={p.inner} />
      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;0.8 0.5;0 0" dur="6s" repeatCount="indefinite" />
        <ellipse cx="-18.6" cy="1.4" rx="6.2" ry="4.8" fill={p.inner} />
        <ellipse cx="-18.6" cy="1.4" rx="6.2" ry="4.8" fill="url(#pet-volume)" />
        <path d="M-13.6 -0.6 Q-14.6 1.4 -13.6 3.4" stroke={p.nose} strokeWidth="0.5" fill="none" strokeOpacity="0.6" />
        <path d="M-21.4 0.2 Q-20 -1.6 -18.6 0.2" stroke={p.line} strokeWidth="0.85" fill="none" />
        <path d="M-23.8 2.8 Q-21 4.6 -18.2 3.4" stroke={p.line} strokeWidth="0.55" fill="none" strokeOpacity="0.75" />
        <circle cx="-23" cy="1.2" r="0.5" fill={p.line} fillOpacity="0.6" />
      </g>
    </>
  );
}

function PetDefs() {
  return (
    <defs>
      <radialGradient id="pet-volume" cx="0.34" cy="0.24" r="0.86">
        <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.34" />
        <stop offset="0.42" stopColor="#FFFFFF" stopOpacity="0.06" />
        <stop offset="0.74" stopColor="#000000" stopOpacity="0.08" />
        <stop offset="1" stopColor="#000000" stopOpacity="0.3" />
      </radialGradient>
      <radialGradient id="pet-cushion" cx="0.4" cy="0.28" r="0.82">
        <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.24" />
        <stop offset="0.58" stopColor="#000000" stopOpacity="0" />
        <stop offset="1" stopColor="#000000" stopOpacity="0.3" />
      </radialGradient>
      <filter id="pet-soft" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="2.4" />
      </filter>
    </defs>
  );
}

function Basket() {
  return (
    <>
      <ellipse cx="0" cy="10" rx="26" ry="14" fill="#8B6B4A" />
      <ellipse cx="0" cy="10" rx="26" ry="14" fill="url(#pet-cushion)" />
      <ellipse cx="0" cy="8" rx="23" ry="12" fill="#A0785A" />
      <ellipse cx="0" cy="6" rx="23" ry="12" fill="none" stroke="#96704E" strokeWidth="1.5" />
      <ellipse cx="0" cy="6" rx="20" ry="10" fill="#C4976A" />
      <ellipse cx="0" cy="6" rx="20" ry="10" fill="url(#pet-cushion)" />
    </>
  );
}

function SandBox() {
  return (
    <>
      <path d="M0 -10 L28 4 L0 18 L-28 4 Z" fill="#A2825C" />
      <path d="M-28 4 L0 18 L0 23.5 L-28 9.5 Z" fill="#8A6C48" />
      <path d="M28 4 L0 18 L0 23.5 L28 9.5 Z" fill="#6B5335" />
      <path d="M0 -6 L23 5 L0 16 L-23 5 Z" fill="#C8B183" />
      <path d="M0 -3.6 L19.5 6 L0 14.6 L-19.5 6 Z" fill="#E4D4A9" />
      <g fill="#BFA97F" fillOpacity="0.6">
        <ellipse cx="-9" cy="8.4" rx="1.1" ry="0.6" />
        <ellipse cx="3" cy="11" rx="0.9" ry="0.5" />
        <ellipse cx="11" cy="7.2" rx="1.2" ry="0.65" />
        <ellipse cx="-2" cy="5.6" rx="0.8" ry="0.45" />
      </g>
      <ellipse cx="-14" cy="6.6" rx="3" ry="1.7" fill="#948A7E" />
      <ellipse cx="-14.6" cy="6" rx="1.9" ry="1" fill="#B0A69A" />
      <ellipse cx="14" cy="8.4" rx="2.3" ry="1.3" fill="#948A7E" />
      <ellipse cx="13.5" cy="7.9" rx="1.4" ry="0.8" fill="#B0A69A" />
    </>
  );
}

function DogBed() {
  return (
    <>
      <path d="M-15 -4 L15 -4 Q30 -4 30 6 Q30 18 15 18 L-15 18 Q-30 18 -30 6 Q-30 -4 -15 -4 Z" fill="#3F5652" />
      <path d="M-15 -4 L15 -4 Q30 -4 30 6 Q30 9 27 10.5 Q26.5 1.5 15 0.5 L-15 0.5 Q-26.5 1.5 -27 10.5 Q-30 9 -30 6 Q-30 -4 -15 -4 Z" fill="#5A7772" />
      <path d="M-14 0.5 L14 0.5 Q26 0.5 26 8 Q26 16 14 16 L-14 16 Q-26 16 -26 8 Q-26 0.5 -14 0.5 Z" fill="#A87F58" />
      <path d="M-13 2.2 L13 2.2 Q24 2.2 24 8.6 Q24 14.6 13 14.6 L-13 14.6 Q-24 14.6 -24 8.6 Q-24 2.2 -13 2.2 Z" fill="#C4976A" />
    </>
  );
}

const PETS: Record<
  PetSpecies,
  {
    Species: (props: { p: PetPalette }) => ReactElement;
    Bed?: () => ReactElement;
    snores?: boolean;
  }
> = {
  cat: { Species: Cat },
  dog: { Species: Dog, Bed: DogBed },
  rabbit: { Species: Rabbit },
  tortoise: { Species: Tortoise, Bed: SandBox, snores: false },
};

function PetCorner({ pet }: { pet: RoomPet | null }) {
  const chosen = pet ?? DEFAULT_ROOM_PET;
  const drawing = PETS[chosen.species] ?? PETS[DEFAULT_ROOM_PET.species];
  const palette = paletteForPet(chosen);
  const Species = drawing.Species;
  const Bed = drawing.Bed ?? Basket;
  const snores = drawing.snores ?? true;
  return (
    <g transform="translate(120, 460)">
      <PetDefs />
      <ellipse cx="2" cy="15" rx="27" ry="13.5" fill="#000" opacity="0.2" filter="url(#pet-soft)" />
      <Bed />
      <ellipse cx="0" cy="5" rx="16" ry="5.5" fill="#000" opacity="0.24" filter="url(#pet-soft)" />
      <Species p={palette} />
      {snores && (
        <>
          <text x="-4" y="-14" fontSize="6" fill="rgba(200,220,255,0.5)" fontFamily="monospace" fontWeight="bold">
            <animate attributeName="y" values="-14;-18;-14" dur="2.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2.5s" repeatCount="indefinite" />z
          </text>
          <text x="2" y="-20" fontSize="5" fill="rgba(200,220,255,0.4)" fontFamily="monospace" fontWeight="bold">
            <animate attributeName="y" values="-20;-24;-20" dur="3s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.2;0.6;0.2" dur="3s" repeatCount="indefinite" />z
          </text>
        </>
      )}
    </g>
  );
}

export function RoomProps() {
  const { currentRoom, rooms } = useAppState();
  const pet = rooms[currentRoom]?.pet ?? null;
  const skin = effectiveRoomSkin(rooms[currentRoom]);
  const skinModule = ROOM_SKIN_MODULES[skin];
  return (
    <svg style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} width={SCENE_W} height={SCENE_H} viewBox={`${VB_X} ${VB_Y} ${SCENE_W} ${SCENE_H}`} overflow="visible">
      <SkinProps skin={skin} />
      {!skinModule.hideOfficeProps && (
        <>
          {/* Potted plant — west corner of office */}
          <g transform="translate(-245, 212) scale(1.5)">
            <rect x="-8" y="0" width="16" height="20" rx="3" fill="#5a4a35" />
            <ellipse cx="0" cy="0" rx="10" ry="4" fill="#6a5a45" />
            <path d="M0 0 Q-10 -20 -4 -30" stroke="#3a8a3a" fill="none" strokeWidth="2" />
            <path d="M0 0 Q8 -17 12 -27" stroke="#4a9a4a" fill="none" strokeWidth="1.8" />
            <path d="M0 0 Q-3 -13 2 -22" stroke="#3a7a3a" fill="none" strokeWidth="1.5" />
            <ellipse cx="-4" cy="-30" rx="5" ry="4" fill="#3a8a3a" opacity="0.7" />
            <ellipse cx="12" cy="-27" rx="4" ry="3" fill="#4a9a4a" opacity="0.7" />
            <ellipse cx="2" cy="-22" rx="4" ry="3.5" fill="#3a7a3a" opacity="0.6" />
          </g>
        </>
      )}

      {!skinModule.hidePet && <PetCorner pet={pet} />}
    </svg>
  );
}
