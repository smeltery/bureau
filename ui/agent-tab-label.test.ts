import { describe, expect, test } from "bun:test";
import type { AgentState } from "../shared/types.ts";
import { agentTabLabel, faceForAgentState } from "./agent-tab-label.ts";

const ALL_AGENT_STATES: AgentState[] = ["idle", "thinking", "tool_executing", "waiting_for_response", "error", "stopped"];

describe("agent tab labels", () => {
  test("maps every agent state to a tab-strip-safe face", () => {
    expect(faceForAgentState("idle")).toBe("(-_-)zz");
    expect(faceForAgentState("thinking")).toBe("~(o_o)~");
    expect(faceForAgentState("tool_executing")).toBe("~(o_o)~");
    expect(faceForAgentState("waiting_for_response")).toBe("(^_^)ﾉ");
    expect(faceForAgentState("error")).toBe("(｡>﹏<｡)");
    expect(faceForAgentState("stopped")).toBe("(-_-)zz");
  });

  test("covers the full AgentState union", () => {
    for (const state of ALL_AGENT_STATES) {
      expect(faceForAgentState(state)).not.toBe("");
    }
  });

  test("keeps related states aligned with the office poses", () => {
    expect(faceForAgentState("thinking")).toBe(faceForAgentState("tool_executing"));
    expect(faceForAgentState("stopped")).toBe(faceForAgentState("idle"));
  });

  test("avoids emoji presentation, variation selectors, and combining marks", () => {
    for (const state of ALL_AGENT_STATES) {
      const face = faceForAgentState(state);
      expect(face).not.toMatch(/[\uFE0E\uFE0F]/);
      expect(face).not.toMatch(/\p{M}/u);
      for (const ch of face) {
        if ((ch.codePointAt(0) ?? 0) < 128) continue;
        expect(ch).not.toMatch(/\p{Emoji}/u);
      }
    }
  });

  test("leads with the state cue for truncated browser tabs", () => {
    expect(agentTabLabel("Bureau1", "waiting_for_response")).toBe("(^_^)ﾉ Bureau1");
  });

  test("falls back to the bare name for unknown future states", () => {
    expect(agentTabLabel("Bureau1", "teleporting" as AgentState)).toBe("Bureau1");
  });
});
