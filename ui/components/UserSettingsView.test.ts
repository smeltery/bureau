import { describe, expect, test } from "bun:test";
import { buildAccountSections } from "./UserSettingsSections.ts";

describe("buildAccountSections", () => {
  test("splits owner account management into access, sessions, devices, and signout", () => {
    expect(buildAccountSections(true, true)).toEqual([
      { section: "access", label: "Access" },
      { section: "office-env", label: "Office variables" },
      { section: "usage", label: "Usage" },
      { section: "storage", label: "Storage" },
      { section: "invites", label: "Invites" },
      { section: "sessions", label: "Sessions" },
      { section: "devices", label: "My devices" },
      { section: "api-tokens", label: "API tokens" },
      { section: "signout", label: "Sign out" },
    ]);
  });

  test("keeps members scoped to their own devices and signout", () => {
    expect(buildAccountSections(false, true)).toEqual([
      { section: "usage", label: "Usage" },
      { section: "devices", label: "My devices" },
      { section: "api-tokens", label: "API tokens" },
      { section: "signout", label: "Sign out" },
    ]);
  });

  test("shows only owner access before a session context is available", () => {
    expect(buildAccountSections(true, false)).toEqual([
      { section: "access", label: "Access" },
      { section: "office-env", label: "Office variables" },
    ]);
  });
});
