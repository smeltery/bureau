export type SharedBrowserAction = (
  | { action: "select"; selector: string; value?: string; label?: string }
  | { action: "upload"; selector: string; file: { name: string; mimeType: string; base64: string } }
  | { action: "read" | "screenshot" }
  | { action: "click"; selector: string }
  | { action: "type"; selector: string; text: string }
  | { action: "navigate"; url: string }
) & { dialog?: "accept" | "dismiss" };

export interface SharedTabGrant {
  id: string;
  deviceId: string;
  userId: string;
  tabId: number;
  origin: string;
  title: string;
  agentIds: string[];
  expiresAt: number | null;
}

export interface SharedBrowserCommand {
  id: string;
  grantId: string;
  tabId: number;
  origin: string;
  input: SharedBrowserAction;
}
