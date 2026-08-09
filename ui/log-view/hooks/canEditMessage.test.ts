import { describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES } from "../../../shared/types.ts";
import { canEditMessage } from "./canEditMessage.ts";

const opts = { isUserMessage: true, alreadyEditing: false };

function agent(over: { state?: string; fork?: boolean } = {}) {
  return {
    state: (over.state ?? "waiting_for_response") as never,
    capabilities: over.fork === undefined ? DEFAULT_AGENT_CAPABILITIES : { ...DEFAULT_AGENT_CAPABILITIES, fork: over.fork },
  };
}

describe("canEditMessage", () => {
  test("a settled user message on a forking backend is editable", () => {
    expect(canEditMessage(agent(), opts)).toBe(true);
  });

  test("a backend that declares it cannot fork gets no edit affordance", () => {
    // The Codex backend declares fork: false, because editing is implemented as
    // a Claude SDK forkSession — offering it there is an affordance that cannot
    // work.
    expect(canEditMessage(agent({ fork: false }), opts)).toBe(false);
  });

  test("only settled agents, only user messages, never mid-edit", () => {
    expect(canEditMessage(agent({ state: "thinking" }), opts)).toBe(false);
    expect(canEditMessage(agent({ state: "tool_executing" }), opts)).toBe(false);
    expect(canEditMessage(agent(), { ...opts, isUserMessage: false })).toBe(false);
    expect(canEditMessage(agent(), { ...opts, alreadyEditing: true })).toBe(false);
  });

  test("an agent record with no capabilities keeps working", () => {
    // Persisted before the field existed. Allowed here and refused server-side
    // if the backend really cannot fork, so the permissive default costs a
    // round trip rather than correctness.
    expect(canEditMessage({ state: "waiting_for_response" as never, capabilities: undefined as never }, opts)).toBe(true);
  });
});
