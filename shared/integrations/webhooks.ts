export interface Webhook {
  id: string;
  name: string;
  userId: string;
  target: { kind: "agent" | "schedule"; id: string };
  events: string[];
  actions: string[];
  fields: string[];
  enabled: boolean;
  createdAt: number;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  at: number;
  status: "accepted" | "ignored" | "failed" | "pending";
  resultId?: string;
  error?: string;
}
