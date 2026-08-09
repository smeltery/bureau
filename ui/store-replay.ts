import type { LogEntry } from "../shared/types.ts";
import type { AppState } from "./store.tsx";

// Reconnect replay window. Every WS (re)connect sends full_state and then
// replays each visible agent's cached transcript one log_entry frame at a time.
// While a window is open those frames land HERE instead of in `logs`, so the
// view keeps showing the conversation it already had; the server's
// `log_replay_complete` fence swaps the buffer in atomically. See
// openLogsReplay for why the swap replaces rather than merges.
export interface LogsReplay {
  logs: Map<string, LogEntry[]>;
  seq: number; // identifies the window (bumped when one opens)
}

// Silent fallback for a `log_replay_complete` that never arrives. The one case
// that actually happens: a UI build goes live the moment it is built (the
// server re-reads ui/dist on every request) while the server it talks to only
// picks up its own changes on restart — so there is a window where a new client
// is talking to a server old enough not to send the fence. Also covers a
// dropped frame. Runs from the moment the window opens; when the fence does
// arrive this never fires.
export const LOG_REPLAY_FALLBACK_MS = 3000;

// The full_state decision: which streams survive hydration, and whether a
// replay window opens.
//
// Wiping `logs` here is what made the conversation blank out and rebuild on
// every mobile app switch: a backgrounded phone's socket freezes, the resume
// ping in ws.ts reconnects, and the server answers with full_state followed by
// a frame-per-entry replay of every visible agent's transcript. So when we
// already have entries, keep rendering them and buffer the replay instead.
//
// The eventual swap REPLACES rather than merges, which is what the wipe was
// protecting: a client that was disconnected across a /clear, a resume, or an
// edit-fork never saw that clear_logs, and merging would concatenate two
// conversations. The replayed set is the server's, so taking it wholesale is
// correct in both cases.
//
// Only the FOCUSED agent's transcript is ever on screen (App.tsx renders
// logs.get(focusedAgent.id), and no other AGENT stream is rendered anywhere —
// CronjobRunView reads its own cronrun-<runId> stream, which the server's
// agent-only replay never covers either way), so that is the only one worth
// holding across the window. Every other stream is dropped right here as
// before, which keeps the transient double-hold to one conversation instead of
// every visible agent's — transcripts run to megabytes and phones are where
// this matters. A dropped cronrun stream comes back on its own: CronjobRunView
// keys its backfill on hydrationEpoch, which full_state bumps.
//
// Nothing cached for it (a genuinely fresh connect, or no agent open) means
// nothing to protect — stay on the straight-through path so a cold start paints
// as it goes.
export function openLogsReplay(state: AppState): { logs: AppState["logs"]; logsReplay: LogsReplay | null } {
  const focusedId = state.focusedAgentId;
  const held = focusedId != null ? state.logs.get(focusedId) : undefined;
  if (focusedId == null || held === undefined || held.length === 0) return { logs: new Map(), logsReplay: null };
  return { logs: new Map([[focusedId, held]]), logsReplay: { logs: new Map(), seq: (state.logsReplay?.seq ?? 0) + 1 } };
}

// Swap the buffered transcripts in and close the window. Outside a window this
// is a no-op returning the SAME state object, so a stray or duplicated fence
// cannot churn renders.
export function commitLogsReplay(state: AppState): AppState {
  if (!state.logsReplay) return state;
  return { ...state, logs: state.logsReplay.logs, logsReplay: null };
}

// Append one entry to a logs map, or null when that stream already holds the id.
// Dedupe by entry id: backfill of a cronjob run can replay entries that already
// arrived live, and the same id should never appear twice. Use a Set for O(1)
// membership rather than entries.some(...).
export function appendEntryToStream(logs: Map<string, LogEntry[]>, entry: LogEntry): Map<string, LogEntry[]> | null {
  const entries = logs.get(entry.agentId) ?? [];
  const seen = new Set(entries.map((e) => e.id));
  if (seen.has(entry.id)) return null;
  const next = new Map(logs);
  next.set(entry.agentId, [...entries, entry]);
  return next;
}

// Apply a clear (or removal) of one stream to a replay buffer in flight, so the
// eventual commit agrees with what already happened to the live logs. Outside a
// replay window this is a no-op.
export function clearStreamInReplay(replay: LogsReplay | null, streamId: string, mode: "clear" | "delete" = "clear"): LogsReplay | null {
  if (!replay) return replay;
  const logs = new Map(replay.logs);
  if (mode === "delete") logs.delete(streamId);
  else logs.set(streamId, []);
  return { ...replay, logs };
}
