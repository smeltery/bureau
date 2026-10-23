import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const agentId = { type: "string", minLength: 1, maxLength: 128 } as const;
export const officeTools: Tool[] = [
  {
    name: "list_agents",
    description: "List the live agents in rooms you can see, including their IDs and current activity.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "read_conversation",
    description: "Read recent messages in a visible agent's current conversation, or a specified session. Replies addressed to this connection are available through read_replies.",
    inputSchema: {
      type: "object",
      properties: { agentId, sessionId: agentId, limit: { type: "integer", minimum: 1, maximum: 200 }, before: { type: "number", minimum: 0 } },
      required: ["agentId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "send_message",
    description:
      "Send a message to an agent as your personal API token. Busy agents queue it. Slash commands and answers to pending member prompts are refused; answer those inside Bureau. Sends are not automatically retried.",
    inputSchema: { type: "object", properties: { agentId, text: { type: "string", minLength: 1, maxLength: 100000 } }, required: ["agentId", "text"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  {
    name: "read_replies",
    description: "Read this token's durable sends and replies after a sequence cursor. Pass the last returned entry's sequence on the next call. Optionally wait for new entries, up to 25 seconds.",
    inputSchema: { type: "object", properties: { after: { type: "integer", minimum: 0 }, waitSeconds: { type: "number", minimum: 0, maximum: 25 } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
];

export class OfficeToolError extends Error {}

export function validateArguments(name: string, args: Record<string, unknown>): void {
  const tool = officeTools.find((tool) => tool.name === name);
  if (!tool) throw new OfficeToolError("unknown_tool");
  const properties = tool.inputSchema.properties ?? {};
  for (const required of tool.inputSchema.required ?? []) {
    if (!(required in args)) throw new OfficeToolError(`missing argument: ${required}`);
  }
  for (const [key, value] of Object.entries(args)) {
    if (!Object.hasOwn(properties, key)) throw new OfficeToolError(`unknown argument: ${key}`);
    const schema = properties[key] as { type: string; minLength?: number; maxLength?: number; minimum?: number; maximum?: number };
    const valid =
      schema.type === "string"
        ? typeof value === "string" && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity)
        : typeof value === "number" &&
          Number.isFinite(value) &&
          (schema.type !== "integer" || Number.isSafeInteger(value)) &&
          value >= (schema.minimum ?? -Infinity) &&
          value <= (schema.maximum ?? Infinity);
    if (!valid) throw new OfficeToolError(`invalid argument: ${key}`);
  }
}
