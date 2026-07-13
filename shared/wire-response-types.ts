// Response to update_*_settings (sent only to the requesting client)
export interface SettingsSaveResponse {
  type: "settings_save_response";
  requestId: string;
  ok: boolean;
  error?: string;
}

// Response to request_settings_validation (sent only to the requesting client)
export interface SettingsValidationResponse {
  type: "settings_validation";
  requestId: string;
  scope: "office" | "room" | "user";
  roomId?: string;
  userId?: string;
  envFile: string | null;
  ok: boolean;
  keyCount?: number;
  error?: string;
}

// Response to spawn / edit_agent (sent only to the requesting client, when requestId provided)
export interface AgentSaveResponse {
  type: "agent_save_response";
  requestId: string;
  ok: boolean;
  error?: string;
}

// Response to request_cwd_validation (sent only to the requesting client)
export interface CwdValidationResponse {
  type: "cwd_validation";
  requestId: string;
  ok: boolean;
  error?: string;
}
