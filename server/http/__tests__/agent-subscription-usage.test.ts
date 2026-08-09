// GET /api/agents/:id/subscription-usage — the route the header's usage pill
// pulls from. Proves the plumbing end to end: access gate, the backend's
// tri-state answer, and the "most constrained window" pick the pill relies on.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { agents } from "../../agents/state.ts";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { handleAgentsRequest } from "../agents.ts";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import type { BackendSession, SubscriptionUsageResult } from "../../backends/types.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";

beforeEach(() => agents.clear());
afterEach(() => agents.clear());

const loopback: AuthResult = { kind: "loopback" };

function installAgent(id: string, getSubscriptionUsage?: () => Promise<SubscriptionUsageResult>) {
  const info: AgentInfo = {
    id,
    name: "Usage Agent",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
    effort: "high",
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.session = {
    async *stream() {},
    async getContextUsage() {
      return null;
    },
    ...(getSubscriptionUsage ? { getSubscriptionUsage } : {}),
    async send() {},
    async approve() {},
    async abort() {},
    canAbortInPlace() {
      return false;
    },
    close() {},
  } satisfies BackendSession;
  agents.set(id, managed);
  return managed;
}

function get(path: string): Request {
  return new Request(`http://local.test${path}`, { method: "GET" });
}

async function read(id: string, auth: AuthResult | null = loopback) {
  const req = get(`/api/agents/${id}/subscription-usage`);
  return handleAgentsRequest(req, new URL(req.url), auth ?? undefined);
}

describe("GET /api/agents/:id/subscription-usage", () => {
  test("returns the reading and points at the most constrained window", async () => {
    installAgent("agent-1", async () => ({
      kind: "usage",
      usage: {
        plan: "max",
        windows: [
          { label: "Weekly", usedPercent: 30, resetsAtMs: null },
          { label: "5-hour", usedPercent: 95, resetsAtMs: 1785000000000 },
        ],
      },
    }));

    const res = await read("agent-1");

    expect(res?.status).toBe(200);
    const body = (await res?.json()) as { usage: { plan: string; primaryIndex: number; sampledAtMs: number } };
    expect(body.usage.plan).toBe("max");
    expect(body.usage.primaryIndex).toBe(1);
    expect(body.usage.sampledAtMs).toBeGreaterThan(0);
  });

  test("answers null — not an error — for a backend that cannot report it", async () => {
    // The pill renders its unknown state off this; it must not look like a
    // transport failure.
    installAgent("agent-2");

    const res = await read("agent-2");

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ usage: null });
  });

  test("keeps the last reading when a later read learns nothing", async () => {
    let answer: SubscriptionUsageResult = { kind: "usage", usage: { plan: "pro", windows: [{ label: "Weekly", usedPercent: 42, resetsAtMs: null }] } };
    installAgent("agent-3", async () => answer);

    await read("agent-3");
    answer = { kind: "unknown" };
    const res = await read("agent-3");

    const body = (await res?.json()) as { usage: { windows: { usedPercent: number }[] } };
    expect(body.usage.windows[0]!.usedPercent).toBe(42);
  });

  test("gates on agent access", async () => {
    const missing = await read("nobody");
    expect(missing?.status).toBe(404);

    installAgent("agent-4");
    const unauthenticated = await read("agent-4", null);
    expect(unauthenticated?.status).toBe(401);
  });
});
