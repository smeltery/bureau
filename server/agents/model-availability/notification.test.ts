import { expect, test } from "bun:test";

test("missing-model notices offer recovery and only the configured receptionist pages its manager", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { expect, mock } from "bun:test";
    const logs = [], pages = [], deliveries = [];
    let changed = 0;
    const officeConfig = { receptionistAgentId: "host" };
    mock.module("./server/agents/state.ts", () => ({
      addLogEntry: (...args) => logs.push(args), officeConfig, rooms: [{id: "room"}],
    }));
    mock.module("./server/users.ts", () => ({ getUserById: () => ({ language: "es" }) }));
    mock.module("./server/pager/store.ts", () => ({
      raisePage: (input) => {
        const created = !pages.some(page => page.key === input.key && page.source.id === input.source.id);
        pages.push(input);
        return {entry: input, created};
      },
    }));
    mock.module("./server/pager/routes.ts", () => ({ pagerDeliveryDeps: { changed: () => changed++ } }));
    mock.module("./server/pager/delivery.ts", () => ({ sendPage: async (entry) => deliveries.push(entry) }));
    const { notifyMissingModel } = await import("./server/agents/model-availability/notification.ts");
    const info = {id: "worker", name: "Ada", userId: "manager", room: 0, modelFamily: "provider/removed"};
    await notifyMissingModel(info);
    expect(logs[0][3]).toEqual({pickModel: true});
    expect(pages).toHaveLength(0);
    info.id = "host";
    await notifyMissingModel(info);
    await notifyMissingModel(info);
    expect(pages).toHaveLength(2);
    expect(deliveries).toHaveLength(1);
    expect(changed).toBe(2);
    expect(pages[0]).toMatchObject({targetUserId: "manager", source: {kind: "agent", id: "host", roomId: "room"}});
    expect(pages[0].title).toContain("OpenCode ya no ofrece");
    expect(pages[0].body).toContain("Ada");
    info.userId = null;
    await notifyMissingModel(info);
    expect(pages).toHaveLength(2);
  `,
    ],
    { env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
});
