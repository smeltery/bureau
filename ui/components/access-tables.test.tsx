import { translatorFor } from "../../shared/i18n/translate.ts";
import { accessFailureText, revokeFailure } from "./access/feedback.ts";
import { describe, expect, test } from "bun:test";
import { sessionExpiryLines, formatInviteRooms } from "./access-tables.tsx";

const rooms = [
  { id: "room-a", name: "Alpha" },
  { id: "room-b", name: "Beta" },
];

describe("formatInviteRooms", () => {
  test("renders a dash when an invite has no room grants", () => {
    expect(formatInviteRooms({}, rooms)).toBe("—");
    expect(formatInviteRooms({ allowedRooms: [] }, rooms)).toBe("—");
  });

  test("renders granted room names and preserves unknown ids", () => {
    expect(formatInviteRooms({ allowedRooms: ["room-b", "missing"] }, rooms)).toBe("Beta, missing");
  });
});

describe("sessionExpiryLines", () => {
  test("shows both deadlines in the reader's locale and the local timezone", () => {
    const session = { expiresAt: new Date(2026, 0, 2, 15, 4).getTime(), absoluteExpiresAt: new Date(2027, 10, 12, 8, 9).getTime() };
    for (const language of ["en", "es", "ca", "zh"] as const) {
      const { t } = translatorFor(language);
      const formatter = new Intl.DateTimeFormat(language, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
      expect(sessionExpiryLines(session, language)).toEqual([
        { label: t("accessUi.inactivity"), value: formatter.format(session.expiresAt) },
        { label: t("accessUi.latest"), value: formatter.format(session.absoluteExpiresAt) },
      ]);
    }
  });
});

test("revocation codes translate at display time while legacy details stay literal", () => {
  for (const language of ["en", "es", "ca", "zh"] as const) {
    const { t } = translatorFor(language);
    expect(accessFailureText(revokeFailure({ reason: "Original", reasonCode: "last_owner_session" }), t)).toBe(t("accessUi.lastOwner"));
    expect(accessFailureText(revokeFailure({ reason: "Original", reasonCode: "last_owner_logout" }), t)).toBe(t("accessUi.lastOwnerLogout"));
    expect(accessFailureText(revokeFailure({ reason: "Original detail {value}", reasonCode: "future_code" }), t)).toBe("Original detail {value}");
  }
});
