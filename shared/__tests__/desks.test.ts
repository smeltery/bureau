import { describe, expect, it } from "bun:test";
import { DESK_COUNT, DESK_SLOTS, isValidDesk } from "../desks.ts";

describe("desk invariants", () => {
  it("keeps the exported count aligned with the slot list", () => {
    expect(DESK_COUNT).toBe(DESK_SLOTS.length);
    expect(DESK_COUNT).toBe(8);
  });

  it("accepts only integer desk indexes inside the configured range", () => {
    expect(isValidDesk(0)).toBe(true);
    expect(isValidDesk(DESK_COUNT - 1)).toBe(true);

    expect(isValidDesk(-1)).toBe(false);
    expect(isValidDesk(DESK_COUNT)).toBe(false);
    expect(isValidDesk(1.5)).toBe(false);
    expect(isValidDesk(Number.NaN)).toBe(false);
  });
});
