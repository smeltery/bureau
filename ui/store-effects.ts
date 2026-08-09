import { useEffect, useRef, type Dispatch } from "react";
import type { ServerMessage } from "../shared/types.ts";
import { shouldNotifyRoom } from "../shared/notifications.ts";
import { playNotificationSound } from "./notification-sound.ts";
import { showDesktopNotification, markAttention } from "./notifications.ts";
import { connect } from "./ws.ts";
import { LOG_REPLAY_FALLBACK_MS } from "./store-replay.ts";
import type { Action, AppState } from "./store.tsx";

export function useStoreEffects(state: AppState, dispatch: Dispatch<Action>) {
  useEffect(() => {
    connect(
      (msg: ServerMessage) => {
        dispatch(msg as Action);
        if (msg.type === "full_state") dispatch({ type: "connected" });
        // Server-initiated session invalidation (revoke / logout / expiry /
        // delete-user fanout). The server sends `session_expired` immediately
        // before force-closing the WS, so reload here lets the login wall take
        // over instead of looping reconnect against a 401-returning upgrade.
        if (msg.type === "session_expired") {
          if (typeof window !== "undefined") window.location.reload();
        }
      },
      (isConnected: boolean) => {
        if (!isConnected) dispatch({ type: "disconnected" });
      },
    );
  }, [dispatch]);

  // Nothing normally closes a replay window here — the server's
  // `log_replay_complete` does, straight through the reducer. This is only the
  // fallback for a server too old to send it (see LOG_REPLAY_FALLBACK_MS).
  // Deps are the boolean and the window id, not `state.logsReplay` itself: the
  // object is replaced on every buffered entry, which would restart the clock.
  const replaying = state.logsReplay !== null;
  const replaySeq = state.logsReplay?.seq ?? 0;
  useEffect(() => {
    if (!replaying) return;
    const id = setTimeout(() => dispatch({ type: "log_replay_complete" }), LOG_REPLAY_FALLBACK_MS);
    return () => clearTimeout(id);
  }, [replaying, replaySeq, dispatch]);

  // Track mobile viewport
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function handleResize() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        dispatch({ type: "set_mobile", isMobile: window.innerWidth < 768 });
      }, 150);
    }
    window.addEventListener("resize", handleResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
    };
  }, [dispatch]);

  // When the tab is hidden and an agent finishes work, alert the user — gated
  // by their per-room notification preference (server-stored notifRooms). The
  // sound is the in-tab cue; the desktop toast + title/favicon badge reach the
  // user when the tab isn't even visible.
  const prevSoundTriggerSeq = useRef(0);
  useEffect(() => {
    const trigger = state.soundTrigger;
    if (trigger.seq > prevSoundTriggerSeq.current && document.hidden) {
      const me = state.sessionContext ? state.users.get(state.sessionContext.username.trim().toLocaleLowerCase()) : undefined;
      const notifRooms = me?.notifRooms ?? [];
      if (shouldNotifyRoom(trigger.roomId, notifRooms)) {
        playNotificationSound();
        markAttention();
        if (trigger.agentId) {
          const agentId = trigger.agentId;
          showDesktopNotification({
            title: `${trigger.agentName ?? "An agent"} is done`,
            body: "Ready for your reply in Bureau.",
            tag: agentId,
            onClick: () => dispatch({ type: "focus", agentId }),
          });
        }
      }
    }
    prevSoundTriggerSeq.current = trigger.seq;
  }, [state.soundTrigger, state.sessionContext, state.users, dispatch]);
}
