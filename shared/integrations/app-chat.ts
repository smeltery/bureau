export interface AppChatBoot {
  name: string;
  hostGen: number;
}

export interface AppChatStatus extends AppChatBoot {
  appUrl: string;
  agentId: string | null;
  sessionExpiresAt: number | null;
}
