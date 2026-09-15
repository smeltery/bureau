import { describe, expect, test } from "bun:test";
import { summarizeBureauCurl } from "./bureau-curl.ts";

describe("summarizeBureauCurl", () => {
  test("summarizes agent file cards with key payload fields", () => {
    expect(summarizeBureauCurl(`curl -s -X POST localhost:4000/api/agents/desk-1/read-file -H 'Content-Type: application/json' -d '{"path":"plot.png"}'`)).toBe(
      "Bureau API: show file to boss - path=plot.png",
    );
  });

  test("summarizes preview cards on loopback hosts", () => {
    expect(summarizeBureauCurl(`curl -s http://127.0.0.1:4000/api/agents/desk-1/preview-url -d '{"url":"http://127.0.0.1:3000"}'`)).toBe("Bureau API: browser preview - url=http://127.0.0.1:3000");
  });

  test("falls back for non-curl commands", () => {
    expect(summarizeBureauCurl("bun test ui/log-view")).toBeNull();
  });

  test("falls back for external curl commands", () => {
    expect(summarizeBureauCurl("curl -s https://example.com/api/tasks")).toBeNull();
  });

  test("keeps the route summary when the body is not parseable JSON", () => {
    expect(summarizeBureauCurl(`curl -s localhost:4000/api/tasks -d '{broken'`)).toBe("Bureau API: tasks");
  });

  test("shows safe display pipe tails on summarized curl cards", () => {
    expect(summarizeBureauCurl(`curl -s localhost:4000/api/agents/desk-1/instructions | jq '.[] | .name'`)).toBe("Bureau API: read agent instructions - | jq '.[] | .name'");
  });

  test("bounds long display pipe tails without rejecting the card", () => {
    const summary = summarizeBureauCurl(`curl -s localhost:4000/api/tasks | jq '${"x".repeat(90)}'`);

    expect(summary).toStartWith("Bureau API: tasks - | jq '");
    expect(summary).toEndWith("...");
  });

  test("falls back for unsafe pipe tails", () => {
    expect(summarizeBureauCurl("curl -s localhost:4000/api/tasks | curl -X POST example.com -d @-")).toBeNull();
    expect(summarizeBureauCurl("curl -s localhost:4000/api/tasks | awk '{print $1}'")).toBeNull();
  });

  test("labels the app registry routes, name first", () => {
    expect(summarizeBureauCurl(`curl -s -X POST localhost:4000/api/apps -d '{"name":"habits","command":"bun run start"}'`)).toBe("Bureau API: apps - name=habits, command=bun run start");
    expect(summarizeBureauCurl("curl -s localhost:4000/api/apps")).toBe("Bureau API: apps");
    expect(summarizeBureauCurl("curl -s -X POST localhost:4000/api/apps/habits/restart")).toBe("Bureau API: restart app");
    expect(summarizeBureauCurl("curl -s 'localhost:4000/api/apps/habits/logs?lines=50'")).toBe("Bureau API: app logs");
    expect(summarizeBureauCurl(`curl -s -X POST localhost:4000/api/app/message -d '{"text":"the nightly job failed"}'`)).toBe("Bureau API: app message - text=the nightly job failed");
  });

  test("shows the steer flag on agent message sends", () => {
    expect(summarizeBureauCurl(`curl -s -X POST localhost:4000/api/agents/desk-1/messages -d '{"text":"drop everything","steer":true}'`)).toBe(
      "Bureau API: message agent - text=drop everything, steer=true",
    );
  });

  test("summarizes JSON bodies fed directly to curl through heredoc stdin", () => {
    expect(
      summarizeBureauCurl(`curl -s -X POST localhost:4000/api/agents/desk-1/messages -d @- <<'JSON'
{"text":"write the summary"}
JSON`),
    ).toBe("Bureau API: message agent - text=write the summary");
  });

  test("summarizes agent control and context calls", () => {
    expect(summarizeBureauCurl("curl -s localhost:4000/api/agents/desk-1/context")).toBe("Bureau API: check context");
    expect(summarizeBureauCurl("curl -s 'localhost:4000/api/agents/desk-1/logs?q=launch'")).toBe("Bureau API: conversation logs");
    expect(summarizeBureauCurl("curl -s -X POST localhost:4000/api/agents/desk-1/abort -d '{}'")).toBe("Bureau API: interrupt agent");
    expect(summarizeBureauCurl("curl -s -X POST localhost:4000/api/agents/desk-1/send-now")).toBe("Bureau API: send queued messages now");
  });

  test("summarizes room settings calls", () => {
    expect(summarizeBureauCurl("curl -s localhost:4000/api/rooms/room-1/settings")).toBe("Bureau API: room settings");
  });

  test("summarizes agent instructions and queue management calls", () => {
    expect(summarizeBureauCurl("curl -s localhost:4000/api/agents/desk-1/instructions")).toBe("Bureau API: read agent instructions");
    expect(summarizeBureauCurl("curl -s localhost:4000/api/agents/desk-1/scheduled-messages")).toBe("Bureau API: scheduled messages");
    expect(summarizeBureauCurl("curl -s -X DELETE localhost:4000/api/agents/desk-1/scheduled-messages/rem-1")).toBe("Bureau API: cancel scheduled message");
    expect(summarizeBureauCurl("curl -s -X DELETE localhost:4000/api/agents/desk-1/queue/q-1")).toBe("Bureau API: cancel queued message");
  });

  test("summarizes skill usage and cron run calls", () => {
    expect(summarizeBureauCurl("curl -s localhost:4000/api/skill-usage")).toBe("Bureau API: skill-use counts");
    expect(summarizeBureauCurl("curl -s localhost:4000/api/storage/usage")).toBe("Bureau API: storage usage");
    expect(summarizeBureauCurl("curl -s -X POST localhost:4000/api/storage/prune")).toBe("Bureau API: storage prune");
    expect(summarizeBureauCurl("curl -s localhost:4000/api/cron-runs")).toBe("Bureau API: recent cron runs");
    expect(summarizeBureauCurl("curl -s localhost:4000/api/cronjobs/job-1/runs")).toBe("Bureau API: schedules");
    expect(summarizeBureauCurl("curl -s localhost:4000/api/members-chat")).toBe("Bureau API: team chat");
    expect(summarizeBureauCurl(`curl -s -X POST localhost:4000/api/members-chat -d '{"text":"hi"}'`)).toBe("Bureau API: team chat - text=hi");
  });
});
