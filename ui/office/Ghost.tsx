import type { CSSProperties, MouseEvent } from "react";
import type { GhostVariant } from "../../shared/avatar.ts";
import { GhostGraphic } from "./ghostVariants.tsx";

interface SharedGhostProps {
  left: number;
  top: number;
  size: number;
  variant: GhostVariant;
  color: string;
  username: string;
  device: string | null;
  userId: string;
  dimmed: boolean;
  onClick?: (userId: string) => void;
}

const GHOST_BODY_Z = 200;
const GHOST_TAG_Z = 20000;
const SVG_HEIGHT_RATIO = 170 / 130;
const SVG_HEAD_TOP_RATIO = 30 / 130;
const TAG_GAP_ABOVE_HEAD = 4;
const TAG_HEIGHT_PX = 16;

function motionStyle(dimmed: boolean, onClick?: unknown): CSSProperties {
  return {
    transition: "left 220ms ease-out, top 220ms ease-out, opacity 220ms",
    opacity: dimmed ? 0.4 : 1,
    cursor: onClick ? "pointer" : "default",
    pointerEvents: "auto",
  };
}

function ghostLabel(username: string, device: string | null): string {
  return device ? `${username} (${device})` : username;
}

function makeClickHandler(userId: string, onClick: ((userId: string) => void) | undefined) {
  return (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.(userId);
  };
}

export function GhostBody({ left, top, size, variant, color, username, device, userId, dimmed, onClick }: SharedGhostProps) {
  return (
    <div
      data-no-pan
      onClick={makeClickHandler(userId, onClick)}
      title={ghostLabel(username, device)}
      style={{
        position: "absolute",
        left,
        top,
        zIndex: GHOST_BODY_Z,
        width: size,
        height: Math.round(size * SVG_HEIGHT_RATIO),
        ...motionStyle(dimmed, onClick),
      }}
    >
      <GhostGraphic variant={variant} color={color} size={size} />
    </div>
  );
}

export function GhostTag({ left, top, size, username, device, userId, dimmed, onClick }: SharedGhostProps) {
  const label = ghostLabel(username, device);
  return (
    <div
      data-no-pan
      onClick={makeClickHandler(userId, onClick)}
      title={label}
      style={{
        position: "absolute",
        left: left + size / 2,
        top: top + Math.round(size * SVG_HEAD_TOP_RATIO) - TAG_HEIGHT_PX - TAG_GAP_ABOVE_HEAD,
        transform: "translateX(-50%)",
        zIndex: GHOST_TAG_Z,
        ...motionStyle(dimmed, onClick),
      }}
    >
      <span
        style={{
          background: "rgba(0,0,0,0.72)",
          color: "white",
          fontSize: 10,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          padding: "1px 7px",
          borderRadius: 8,
          whiteSpace: "nowrap",
          maxWidth: 140,
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "inline-block",
          lineHeight: "14px",
        }}
      >
        {label}
      </span>
    </div>
  );
}
