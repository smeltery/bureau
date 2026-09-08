import { describe, expect, test } from "bun:test";
import { vesselForAgentType } from "./deskSpriteData.ts";

describe("vesselForAgentType", () => {
  test("Claude desks get a mug", () => {
    expect(vesselForAgentType("claude")).toBe("mug");
  });

  test("Codex desks get a teacup", () => {
    expect(vesselForAgentType("codex")).toBe("cup");
  });

  test("missing backend defaults to mug", () => {
    expect(vesselForAgentType(undefined)).toBe("mug");
  });
});
