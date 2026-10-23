export interface QuestionContent {
  prompt: string;
  options?: string[];
  recommended?: string;
  link?: string;
}

export interface MemberQuestion extends QuestionContent {
  id: string;
  agentId: string;
  memberUserId: string;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
  status: "open" | "delivering" | "delivered" | "failed" | "uncertain";
  answer?: {
    text: string;
    dismissed: boolean;
    username: string;
    userId: string;
    attemptId: string;
    error?: string;
  };
}
