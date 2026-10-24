export type RecordingEndReason = "disabled" | "serverStopped" | "sizeLimit" | "terminalClosed";
export type RecordingEvent =
  | { type: "output"; at: number; data: string }
  | { type: "resize"; at: number; cols: number; rows: number }
  | { type: "typist"; at: number; actor: string; unknownActor?: boolean }
  | { type: "end"; at: number; reason: string; reasonCode?: RecordingEndReason };
export interface RecordingHeader {
  version: 1;
  id: string;
  agentId: string;
  roomId: string;
  startedAt: number;
  cols: number;
  rows: number;
}
export interface RecordingView {
  header: RecordingHeader;
  events: RecordingEvent[];
  active: boolean;
}
export type RecordingStatus = "off" | "recording" | "stopped" | "error";
