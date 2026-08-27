import { describe, expect, test } from "bun:test";
import { describeUserMessageSender } from "./UserMessage.tsx";

describe("describeUserMessageSender", () => {
  test("labels cron job senders as non-human even when a username is present", () => {
    expect(
      describeUserMessageSender({
        username: "Nil",
        cronjobName: "Business health check",
      }),
    ).toEqual({ label: "Business health check · cron job", fromHuman: false });
  });
});
