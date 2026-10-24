import type { BackendSession } from "../../backends/types.ts";
import { bureauTurnFailure } from "../../backends/session-types.ts";
import { logMessage } from "../../../shared/i18n/log-message.ts";
import { runConsumer } from "../session/event-consumer.ts";
import { installModelAvailabilityRequests } from "./activity.ts";
import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_AGENT_CAPABILITIES } from "../../../shared/types.ts";
import { LOGS_DIR } from "../../persistence/paths.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, emit, logCache } from "../state.ts";
import { createModelMonitor } from "./runtime.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
});
function fixture() {
  const id = `model-runtime-${crypto.randomUUID()}`;
  const managed = createManagedAgent({
    info: {
      id,
      name: "Topic",
      desk: 0,
      room: 0,
      cwd: process.cwd(),
      agentType: "opencode",
      modelFamily: "provider/chosen",
      permissionMode: "default",
      outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
      capabilities: DEFAULT_AGENT_CAPABILITIES,
      state: "idle",
      topic: "Original",
      topicStale: true,
      customInstructions: null,
    },
    skillCwd: process.cwd(),
    sessionId: "first",
    slashCommands: [],
    skills: [],
  });
  agents.set(id, managed);
  logCache.set(id, [{ id: "prompt", agentId: id, kind: "user_message", content: "Deployment question", timestamp: 1 }]);
  cleanup.push(() => {
    agents.delete(id);
    logCache.delete(id);
    rmSync(join(LOGS_DIR, id), { recursive: true, force: true });
  });
  return managed;
}

test("live checks flag once, preserve unknown results and clear a restored model without changing selection", async () => {
  const managed = fixture();
  let models = [{ id: "provider/other" }];
  let notices = 0;
  const monitor = createModelMonitor({
    environment: () => ({}),
    list: async (options) => {
      expect(options.requireLive).toBe(true);
      return models;
    },
    missing: () => {
      notices++;
    },
  });
  cleanup.push(monitor.stop);
  await monitor.run(managed.info.id);
  await monitor.run(managed.info.id);
  expect(managed.info.unavailableModel).toBe("provider/chosen");
  expect(managed.info.modelFamily).toBe("provider/chosen");
  expect(notices).toBe(1);
  models = [];
  await monitor.run(managed.info.id);
  expect(managed.info.unavailableModel).toBe("provider/chosen");
  models = [{ id: "provider/chosen" }];
  await monitor.run(managed.info.id);
  expect(managed.info.unavailableModel).toBeNull();
});

test("configuration changes invalidate pending checks even when the model changes back", async () => {
  const managed = fixture();
  let finish!: (models: { id: string }[]) => void;
  const monitor = createModelMonitor({
    environment: () => ({}),
    list: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    missing: () => {
      throw new Error("Stale notification");
    },
    error: () => {
      throw new Error("Unexpected error");
    },
  });
  cleanup.push(monitor.stop);
  const pending = monitor.run(managed.info.id);
  managed.info.modelFamily = "provider/other";
  emit({ type: "agent_updated", agentId: managed.info.id, changes: { modelFamily: managed.info.modelFamily } });
  managed.info.modelFamily = "provider/chosen";
  emit({ type: "agent_updated", agentId: managed.info.id, changes: { modelFamily: managed.info.modelFamily } });
  finish([{ id: "provider/other" }]);
  await pending;
  expect(managed.info.unavailableModel).toBeNull();
});

test("credential changes, deletion and shutdown reject late results", async () => {
  for (const invalidate of ["credentials", "delete", "stop"]) {
    const managed = fixture();
    let key = "first";
    let finish!: (models: { id: string }[]) => void;
    const monitor = createModelMonitor({
      environment: () => ({ OPENCODE_API_KEY: key }),
      list: (options) => {
        expect(options.env?.OPENCODE_API_KEY).toBe("first");
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      missing: () => {
        throw new Error("Stale notification");
      },
      error: () => {
        throw new Error("Unexpected error");
      },
    });
    cleanup.push(monitor.stop);
    const pending = monitor.run(managed.info.id);
    if (invalidate === "credentials") key = "second";
    else if (invalidate === "delete") agents.delete(managed.info.id);
    else monitor.stop();
    finish([{ id: "provider/other" }]);
    await pending;
    expect(managed.info.unavailableModel).toBeNull();
  }
});

test("a configuration event clears the warning in both live state and emitted changes", () => {
  const managed = fixture();
  managed.info.unavailableModel = managed.info.modelFamily;
  const changes = { cwd: "/new-project" };
  emit({ type: "agent_updated", agentId: managed.info.id, changes });
  expect(managed.info.unavailableModel).toBeNull();
  expect(changes).toHaveProperty("unavailableModel", null);
});

test("a failed model turn retains its recovery control and requests a catalog check", async () => {
  const managed = fixture();
  const requested: string[] = [];
  cleanup.push(
    installModelAvailabilityRequests((id) => {
      requested.push(id);
    }),
  );
  const session: BackendSession = {
    async *stream() {
      yield { ...bureauTurnFailure(logMessage("logs.provider.model")), pickModel: true, causedByAuth: false };
    },
    async getContextUsage() {
      return null;
    },
    async send() {},
    async approve() {},
    async abort() {},
    canAbortInPlace() {
      return false;
    },
    close() {},
  };
  managed.session = session;
  await runConsumer(managed.info.id, managed, session);
  expect(requested).toEqual([managed.info.id]);
  expect(logCache.get(managed.info.id)?.find((entry) => entry.metadata?.pickModel)).toMatchObject({ kind: "error", message: { key: "logs.provider.model" } });
  expect(managed.info.state).toBe("error");
});
