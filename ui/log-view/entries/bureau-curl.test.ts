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

  test("summarizes JSON bodies fed directly to curl through heredoc stdin", () => {
    expect(
      summarizeBureauCurl(`curl -s -X POST localhost:4000/api/agents/desk-1/messages -d @- <<'JSON'
{"text":"write the summary"}
JSON`),
    ).toBe("Bureau API: message agent - text=write the summary");
  });

  test("summarizes agent control and context calls", () => {
    expect(summarizeBureauCurl("curl -s localhost:4000/api/agents/desk-1/context")).toBe("Bureau API: check context");
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
    expect(summarizeBureauCurl("curl -s localhost:4000/api/cron-runs")).toBe("Bureau API: recent cron runs");
    expect(summarizeBureauCurl("curl -s localhost:4000/api/cronjobs/job-1/runs")).toBe("Bureau API: cron jobs");
  });
});
