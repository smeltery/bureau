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
});
