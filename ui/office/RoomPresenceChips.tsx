import type { PresenceInfo } from "../../shared/types.ts";
import { GhostGraphic } from "./ghostVariants.tsx";

const MINI_GHOST_SIZE = 12;
const MAX_MINI_GHOSTS = 3;
const MINI_GHOST_OVERLAP = -8;

export function MiniGhostCluster({ presences, selfConnectionId }: { presences: PresenceInfo[]; selfConnectionId: string | null }) {
  const visible = (selfConnectionId ? presences.filter((presence) => presence.connectionId !== selfConnectionId) : presences).slice(0, MAX_MINI_GHOSTS);
  if (visible.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, verticalAlign: "middle" }}>
      {visible.map((presence, index) => {
        const title = presence.device ? `${presence.username} (${presence.device})` : presence.username;
        return (
          <span
            key={presence.connectionId}
            title={title}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginLeft: index === 0 ? 0 : MINI_GHOST_OVERLAP,
              opacity: presence.viewMode === "away" ? 0.4 : 1,
              transform: "translateY(1px)",
            }}
          >
            <GhostGraphic variant={presence.avatarVariant} color={presence.avatarColor} size={MINI_GHOST_SIZE} animated={false} shadow={false} />
          </span>
        );
      })}
    </span>
  );
}

export function TotalOnlineChip({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count === 1 ? "1 online user" : `${count} online users`;
  return (
    <span
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginLeft: "auto",
        paddingLeft: 12,
        color: "var(--text-dim)",
        fontStyle: "italic",
        fontSize: 11,
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 4px var(--green)", flexShrink: 0 }} />
      {label}
    </span>
  );
}
