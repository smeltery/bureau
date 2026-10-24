import type { PlainMessageKey } from "../../../shared/i18n/translate.ts";
import type { ComponentType } from "react";
import type { AgentOutfit } from "../../../shared/types.ts";
import { EmployeePlaque } from "./props-plaque.tsx";
import { SofaBoxy, SofaLoveseat, SofaChesterfield, ArmchairClub, ArmchairEgg } from "./props-seating.tsx";
import { TableRound, TableGlass, FireplaceBrick, FireplaceModern, BookshelfTall, Credenza, FishTankStand, FishBowl, LampArc, LampTripod } from "./props-furniture.tsx";
import {
  RugOval,
  RugRect,
  RugRound,
  PlantCorner,
  PlantMonstera,
  Bunting,
  FramedPoster,
  CatCurled,
  CatSitting,
  DirectoryBoard,
  DirectorySign,
  ReceptionCounter,
  type DirectoryRoom,
} from "./props-decor.tsx";

// Registry of every prop and its variants. Layouts (slice 3) place variants
// by id; the contact sheet renders them all. Floor props anchor at their
// floor contact centre; wall props anchor at the wall contact point and are
// drawn in the wall plane.

export interface PropStar {
  name: string;
  outfit: AgentOutfit;
}

export interface PropContext {
  rooms: DirectoryRoom[];
  officeName: string;
  wall: "left" | "right";
  // Employee of the Minute, office-wide; null hides the plaque's portrait.
  star: PropStar | null;
  // "near" means the piece is seen from behind: its backrest stands between
  // the viewer and its seat. Only the upholstered pieces use it.
  back: "far" | "near";
}

export interface PropVariant {
  id: string;
  labelKey: PlainMessageKey;
  Component: ComponentType<PropContext>;
  // Contact shadow ellipse (screen units). Absent for wall pieces and rugs.
  shadow?: { rx: number; ry: number };
  wall?: boolean;
  // Carries text or an asymmetric design that must not be mirrored.
  noFlip?: boolean;
  // How many ways this prop can face. 4 means it has a drawn back, so it can
  // be turned around (the upholstered pieces and the counter); 2 means it can
  // only be mirrored left to right; 1 means it always looks the same. Default:
  // 2, or 1 when the prop must not be mirrored.
  facings?: 1 | 2 | 4;
  // Approximate screen height above the anchor, used by the sheet to frame.
  height: number;
}

export interface PropFamily {
  id: string;
  labelKey: PlainMessageKey;
  variants: PropVariant[];
}

const noCtx = (C: ComponentType) => {
  const Wrapped = () => <C />;
  Wrapped.displayName = C.name;
  return Wrapped as ComponentType<PropContext>;
};

export const LOBBY_PROPS: PropFamily[] = [
  {
    id: "sofa",
    labelKey: "settingsUi.propSofa",
    variants: [
      {
        id: "boxy",
        facings: 4,
        labelKey: "settingsUi.propBoxySlate",
        Component: ({ back }) => <SofaBoxy back={back} />,
        shadow: { rx: 66, ry: 30 },
        height: 60,
      },
      {
        id: "loveseat",
        facings: 4,
        labelKey: "settingsUi.propMustardLoveseat",
        Component: ({ back }) => <SofaLoveseat back={back} />,
        shadow: { rx: 54, ry: 26 },
        height: 60,
      },
      {
        id: "chesterfield",
        facings: 4,
        labelKey: "settingsUi.propOxbloodChesterfield",
        Component: ({ back }) => <SofaChesterfield back={back} />,
        shadow: { rx: 70, ry: 32 },
        height: 62,
      },
    ],
  },
  {
    id: "armchair",
    labelKey: "settingsUi.propArmchair",
    variants: [
      {
        id: "club",
        facings: 4,
        labelKey: "settingsUi.propLeatherClub",
        Component: ({ back }) => <ArmchairClub back={back} />,
        shadow: { rx: 36, ry: 20 },
        height: 56,
      },
      {
        id: "egg",
        labelKey: "settingsUi.propSageEggChair",
        Component: noCtx(ArmchairEgg),
        shadow: { rx: 22, ry: 11 },
        height: 70,
      },
    ],
  },
  {
    id: "table",
    labelKey: "settingsUi.propCoffeeTable",
    variants: [
      {
        id: "round",
        labelKey: "settingsUi.propRoundWood",
        Component: noCtx(TableRound),
        shadow: { rx: 26, ry: 13 },
        height: 34,
      },
      {
        id: "glass",
        labelKey: "settingsUi.propGlassRectangle",
        Component: noCtx(TableGlass),
        shadow: { rx: 40, ry: 20 },
        height: 32,
      },
    ],
  },
  {
    id: "fireplace",
    labelKey: "settingsUi.propFireplace",
    variants: [
      {
        id: "brick",
        labelKey: "settingsUi.propBrickWithMantel",
        Component: noCtx(FireplaceBrick),
        shadow: { rx: 48, ry: 22 },
        height: 100,
      },
      {
        id: "modern",
        labelKey: "settingsUi.propStoneSlab",
        Component: noCtx(FireplaceModern),
        shadow: { rx: 60, ry: 24 },
        height: 70,
      },
    ],
  },
  {
    id: "shelf",
    labelKey: "settingsUi.propShelving",
    variants: [
      {
        id: "tall",
        labelKey: "settingsUi.propTallBookcase",
        Component: noCtx(BookshelfTall),
        shadow: { rx: 32, ry: 16 },
        height: 90,
      },
      {
        id: "credenza",
        labelKey: "settingsUi.propCredenza",
        Component: noCtx(Credenza),
        shadow: { rx: 42, ry: 20 },
        height: 50,
      },
    ],
  },
  {
    id: "tank",
    labelKey: "settingsUi.propFish",
    variants: [
      {
        id: "stand",
        labelKey: "settingsUi.propTankOnStand",
        Component: noCtx(FishTankStand),
        shadow: { rx: 32, ry: 16 },
        height: 68,
      },
      {
        id: "bowl",
        labelKey: "settingsUi.propBowlOnSideTable",
        Component: noCtx(FishBowl),
        shadow: { rx: 18, ry: 9 },
        height: 52,
      },
    ],
  },
  {
    id: "lamp",
    labelKey: "settingsUi.propFloorLamp",
    variants: [
      {
        id: "arc",
        labelKey: "settingsUi.propArcLamp",
        Component: noCtx(LampArc),
        shadow: { rx: 13, ry: 6.5 },
        height: 118,
      },
      {
        id: "tripod",
        labelKey: "settingsUi.propTripodDrum",
        Component: noCtx(LampTripod),
        shadow: { rx: 16, ry: 8 },
        height: 84,
      },
    ],
  },
  {
    id: "rug",
    labelKey: "settingsUi.propRug",
    variants: [
      {
        id: "oval",
        facings: 1,
        labelKey: "settingsUi.propOvalWelcome",
        Component: noCtx(RugOval),
        noFlip: true,
        height: 26,
      },
      {
        id: "rect",
        facings: 1,
        labelKey: "settingsUi.propStripedKilim",
        Component: noCtx(RugRect),
        height: 40,
      },
      {
        id: "round",
        facings: 1,
        labelKey: "settingsUi.propBraidedRound",
        Component: noCtx(RugRound),
        height: 22,
      },
    ],
  },
  {
    id: "plant",
    labelKey: "settingsUi.propPlant",
    variants: [
      {
        id: "corner",
        labelKey: "settingsUi.propOfficeCornerPlant",
        Component: noCtx(PlantCorner),
        shadow: { rx: 25, ry: 12.5 },
        height: 90,
      },
      {
        id: "monstera",
        labelKey: "settingsUi.propMonstera",
        Component: noCtx(PlantMonstera),
        shadow: { rx: 18, ry: 9 },
        height: 70,
      },
    ],
  },
  {
    id: "wallart",
    labelKey: "settingsUi.propWallPiece",
    variants: [
      {
        id: "bunting",
        labelKey: "settingsUi.propWelcomeBunting",
        Component: ({ wall }) => <Bunting wall={wall} />,
        wall: true,
        noFlip: true,
        height: 50,
      },
      {
        id: "poster",
        labelKey: "settingsUi.propFramedPoster",
        Component: ({ wall }) => <FramedPoster wall={wall} />,
        wall: true,
        noFlip: true,
        height: 70,
      },
    ],
  },
  {
    id: "cat",
    labelKey: "settingsUi.propCat",
    variants: [
      {
        id: "curled",
        labelKey: "settingsUi.propCurledTabby",
        Component: noCtx(CatCurled),
        shadow: { rx: 18, ry: 8 },
        height: 18,
      },
      {
        id: "sitting",
        labelKey: "settingsUi.propSittingGrey",
        Component: noCtx(CatSitting),
        shadow: { rx: 12, ry: 5 },
        height: 40,
      },
    ],
  },
  {
    id: "directory",
    labelKey: "settingsUi.propDirectory",
    variants: [
      {
        id: "board",
        labelKey: "settingsUi.propWallBulletin",
        Component: ({ wall, rooms, officeName }) => <DirectoryBoard wall={wall} rooms={rooms} officeName={officeName} />,
        wall: true,
        noFlip: true,
        height: 70,
      },
      {
        id: "sign",
        labelKey: "settingsUi.propAFrameChalkboard",
        Component: ({ rooms, officeName }) => <DirectorySign rooms={rooms} officeName={officeName} />,
        shadow: { rx: 20, ry: 9 },
        noFlip: true,
        height: 56,
      },
    ],
  },
  {
    id: "plaque",
    labelKey: "settingsUi.propEmployeeOfTheMinute",
    variants: [
      {
        id: "framed",
        labelKey: "settingsUi.propFramedPortrait",
        Component: ({ wall, star }) => (star ? <EmployeePlaque wall={wall} name={star.name} outfit={star.outfit} /> : <g />),
        wall: true,
        noFlip: true,
        height: 70,
      },
    ],
  },
  {
    id: "counter",
    labelKey: "settingsUi.propReception",
    variants: [
      {
        id: "counter",
        facings: 4,
        labelKey: "settingsUi.propWoodCounter",
        Component: ({ back }) => <ReceptionCounter back={back} />,
        shadow: { rx: 66, ry: 30 },
        height: 60,
      },
    ],
  },
];

/** How many ways a prop can face: see PropVariant.facings. */
export function variantFacings(v: PropVariant): 1 | 2 | 4 {
  return v.facings ?? (v.noFlip ? 1 : 2);
}

export function findVariant(familyId: string, variantId: string): PropVariant | undefined {
  return LOBBY_PROPS.find((f) => f.id === familyId)?.variants.find((v) => v.id === variantId);
}

// Shared defs a scene or sheet must include once so props can reference them.
export function PropDefs() {
  return (
    <defs>
      <linearGradient id="lobby-glass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
        <stop offset="0.45" stopColor="#fff" stopOpacity="0.02" />
        <stop offset="1" stopColor="#fff" stopOpacity="0.12" />
      </linearGradient>
    </defs>
  );
}
