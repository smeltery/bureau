import type { TaskPriority } from "../tasks.ts";

export interface QuestionContent {
  prompt: string;
  // How urgent the decision is, on the task board's scale (P0 most urgent).
  priority?: TaskPriority;
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
    // Set when the member filed the question on the task board instead.
    taskId?: string;
  };
}
