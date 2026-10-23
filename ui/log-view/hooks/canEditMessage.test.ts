import { describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES } from "../../../shared/types.ts";
import { canEditMessage } from "./canEditMessage.ts";

const opts = { isUserMessage: true, alreadyEditing: false };

function agent(over: { state?: string; edit?: boolean } = {}) {
  return {
    state: (over.state ?? "waiting_for_response") as never,
    capabilities: over.edit === undefined ? DEFAULT_AGENT_CAPABILITIES : { ...DEFAULT_AGENT_CAPABILITIES, edit: over.edit },
  };
}

describe("canEditMessage", () => {
  test("a settled user message on a backend supporting edits is editable", () => {
    expect(canEditMessage(agent(), opts)).toBe(true);
  });

  test("a stopped agent can edit the interrupted message", () => {
    expect(canEditMessage(agent({ state: "stopped" }), opts)).toBe(true);
  });

  test("a backend that declares it cannot edit gets no edit affordance", () => {
    expect(canEditMessage(agent({ edit: false }), opts)).toBe(false);
  });

  test("editing does not require unrestricted forking", () => {
    expect(canEditMessage({ ...agent(), capabilities: { ...DEFAULT_AGENT_CAPABILITIES, fork: false, edit: true } }, opts)).toBe(true);
  });

  test("only settled agents, only user messages, never mid-edit", () => {
    expect(canEditMessage(agent({ state: "thinking" }), opts)).toBe(false);
    expect(canEditMessage(agent({ state: "tool_executing" }), opts)).toBe(false);
    expect(canEditMessage(agent(), { ...opts, isUserMessage: false })).toBe(false);
    expect(canEditMessage(agent(), { ...opts, alreadyEditing: true })).toBe(false);
  });

  test("an agent record with no capabilities keeps working", () => {
    // Persisted before the field existed. Allowed here and refused server-side
    // if the backend really cannot edit, so the permissive default costs a
    // round trip rather than correctness.
    expect(canEditMessage({ state: "waiting_for_response" as never, capabilities: undefined as never }, opts)).toBe(true);
  });
});
