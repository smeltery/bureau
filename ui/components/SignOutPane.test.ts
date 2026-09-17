import { describe, expect, test } from "bun:test";
import { signOutEnabled } from "./SignOutPane.tsx";

describe("signOutEnabled", () => {
  test("stays interactive only while a session is present", () => {
    expect(signOutEnabled(true)).toBe(true);
    expect(signOutEnabled(false)).toBe(false);
  });
});
