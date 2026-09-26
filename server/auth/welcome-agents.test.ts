import { afterEach, describe, expect, test } from "bun:test";

import { agents } from "../agents/state.ts";
import { seedWelcomeAgents } from "./welcome-agents.ts";

afterEach(() => {
  agents.clear();
});

describe("seedWelcomeAgents", () => {
  test("is a no-op when the office already has agents", async () => {
    agents.set("existing", { info: { id: "existing", name: "Existing" } } as any);
    await seedWelcomeAgents("Boss");
    expect(agents.size).toBe(1);
    expect(agents.has("existing")).toBe(true);
  });

  test("seeds Claude, Codex, and free OpenCode welcome agents", async () => {
    await seedWelcomeAgents("Boss");

    const seeded = [...agents.values()].map((agent) => agent.info);
    expect(seeded.map((agent) => agent.name).sort()).toEqual(["Claude Welcome Agent", "Codex Welcome Agent", "Free Welcome Agent"]);
    expect(seeded.find((agent) => agent.name === "Free Welcome Agent")).toMatchObject({
      agentType: "opencode",
      modelFamily: "opencode/nemotron-3-ultra-free",
      permissionMode: "bypassPermissions",
    });
  });
});
