import { describe, expect, test } from "bun:test";
import { formatApiTokenDevice, isApiTokenDevice } from "../../../shared/identity.ts";
import { describeUserMessageSender } from "./UserMessage.tsx";

describe("formatApiTokenDevice", () => {
  test("produces a device string recognized as API-token-originated", () => {
    for (const name of ["phone", `\n\u0000"${"x".repeat(80)}`, '"', "   "]) {
      expect(isApiTokenDevice(formatApiTokenDevice(name))).toBe(true);
    }
  });

  test("does not match ordinary devices", () => {
    for (const device of [undefined, "", "Phone", "Windows", "api token x"]) {
      expect(isApiTokenDevice(device)).toBe(false);
    }
  });
});

describe("describeUserMessageSender", () => {
  test("labels cron job senders as non-human even when a username is present", () => {
    expect(
      describeUserMessageSender({
        username: "Nil",
        cronjobName: "Business health check",
      }),
    ).toEqual({ label: "Business health check · cron job", fromHuman: false });
  });

  test("keeps agent senders ahead of human fallback", () => {
    expect(describeUserMessageSender({ agentName: "Peer", agentRoom: "Lobby", username: "Nil" })).toEqual({ label: 'Peer · agent · Room "Lobby"', fromHuman: false });
  });

  test("labels API token senders with human attribution but machine styling", () => {
    expect(describeUserMessageSender({ username: "Nil", device: 'API token "phone"' })).toEqual({ label: 'Nil (API token "phone")', fromHuman: false });
  });
});
