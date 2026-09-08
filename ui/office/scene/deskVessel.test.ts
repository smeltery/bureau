import { describe, expect, test } from "bun:test";
import { vesselForAgentType } from "./deskSpriteData.ts";

describe("vesselForAgentType", () => {
  test("Claude desks get a mug", () => {
    expect(vesselForAgentType("claude")).toBe("mug");
  });

  test("Codex desks get a teacup", () => {
    expect(vesselForAgentType("codex")).toBe("cup");
  });

  test("OpenCode desks get a flask", () => {
    expect(vesselForAgentType("opencode")).toBe("flask");
  });

  test("missing backend defaults to mug", () => {
    expect(vesselForAgentType(undefined)).toBe("mug");
  });
});
