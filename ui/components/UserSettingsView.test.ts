import { describe, expect, test } from "bun:test";
import { ACCOUNT_SECTION_LABEL_KEYS, buildAccountSections } from "./UserSettingsSections.ts";
import { en } from "../../shared/i18n/en.ts";

describe("buildAccountSections", () => {
  test("splits owner account management into access, sessions, devices, and signout", () => {
    expect(buildAccountSections(true, true).map((entry) => entry.section)).toEqual([
      "access",
      "connections",
      "office-env",
      "personal-env",
      "usage",
      "storage",
      "invites",
      "sessions",
      "devices",
      "api-tokens",
      "pager",
      "signout",
    ]);
  });

  test("keeps members scoped to their own devices and signout", () => {
    expect(buildAccountSections(false, true).map((entry) => entry.section)).toEqual(["connections", "personal-env", "usage", "devices", "api-tokens", "pager", "signout"]);
  });

  test("shows only owner access before a session context is available", () => {
    expect(buildAccountSections(true, false).map((entry) => entry.section)).toEqual(["access", "office-env", "signout"]);
  });

  test("keeps Sign out visible without a session for members", () => {
    expect(buildAccountSections(false, false).map((entry) => entry.section)).toEqual(["signout"]);
  });

  test("sidebar label keys exist in the English catalog", () => {
    for (const key of Object.values(ACCOUNT_SECTION_LABEL_KEYS)) {
      expect(en[key]).toBeTruthy();
    }
  });
});
