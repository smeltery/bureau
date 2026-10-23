export type RecordingEvent =
  | { type: "output"; at: number; data: string }
  | { type: "resize"; at: number; cols: number; rows: number }
  | { type: "typist"; at: number; actor: string }
  | { type: "end"; at: number; reason: string };
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
