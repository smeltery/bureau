import { describe, expect, test } from "bun:test";
import { ManagedEnvValidationError, serializeManagedEnv } from "../persistence/managed-env.ts";

describe("managed env", () => {
  test("serializes keys deterministically and quotes values", () => {
    expect(serializeManagedEnv({ ZED: "last", ALPHA: "first value", QUOTE: "can't" })).toBe("ALPHA='first value'\nQUOTE='can't'\nZED='last'\n");
  });

  test("rejects unsafe keys and unsupported control characters", () => {
    expect(() => serializeManagedEnv({ "bad-key": "value" })).toThrow(ManagedEnvValidationError);
    expect(() => serializeManagedEnv({ GOOD: "bad\u0007value" })).toThrow(ManagedEnvValidationError);
  });
});
