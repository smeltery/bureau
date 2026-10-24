import { expect, test } from "bun:test";
import type { LogEntry } from "../../../shared/types.ts";
import { createSessionSummarizer, summaryChunk, type SummaryRequest, type SummaryState } from "./summary.ts";

const entry = (id: number, content = `Thread ${id}`, kind: LogEntry["kind"] = "text"): LogEntry => ({ id: String(id), agentId: "agent", kind, content, timestamp: id });
function fixture(entries: LogEntry[]) {
  let state: SummaryState | null = { entries };
  let clock = 0;
  const errors: unknown[] = [],
    writes: string[] = [];
  const request = createSessionSummarizer({
    read: () => state,
    write: (_request, previous, summary, throughEntryId) => {
      if (!state || state !== previous) return false;
      state = { ...state, summary, throughEntryId };
      writes.push(throughEntryId);
      return true;
    },
    now: () => clock,
    onError: (error) => errors.push(error),
  });
  const job = (generate: SummaryRequest["generate"], scope = "account/model"): SummaryRequest => ({ agentId: "agent", sessionId: "session", scope, generate });
  return {
    request,
    job,
    errors,
    writes,
    read: () => state,
    set: (next: SummaryState | null) => {
      state = next;
    },
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
  };
}

test("summary inputs use conversation entries, preserve heads/tails and recover missing markers", () => {
  expect(summaryChunk({ entries: [entry(1), entry(2), entry(3)] })).toBeNull();
  const result = summaryChunk({
    summary: "Earlier topic",
    throughEntryId: "missing",
    entries: [entry(1, "START" + "x".repeat(4_000) + "END"), entry(2), entry(3, "reply", "api_token_outbound"), entry(4), entry(5, "TOOL SECRET", "tool_result")],
  })!;
  expect(result.prompt).toContain("Earlier topic");
  expect(result.prompt).toContain("START");
  expect(result.prompt).toContain("END");
  expect(result.prompt).not.toContain("x".repeat(2_000));
  expect(result.prompt).not.toContain("TOOL SECRET");
  expect(result.throughEntryId).toBe("4");
});

test("large backlogs summarize every chunk and retain the previous paragraph", async () => {
  const f = fixture(Array.from({ length: 170 }, (_, i) => entry(i, "x".repeat(2_000))));
  const prompts: string[] = [];
  await f.request(
    f.job(async (prompt) => {
      prompts.push(prompt);
      return `Paragraph ${prompts.length}`;
    }),
  );
  expect(prompts).toHaveLength(3);
  expect(prompts[1]).toContain("Paragraph 1");
  expect(prompts[2]).toContain("Paragraph 2");
  expect(f.read()?.throughEntryId).toBe("169");
  expect(f.writes).toHaveLength(3);
  await f.request(
    f.job(async () => {
      throw new Error("unchanged sessions must not generate");
    }),
  );
  expect(f.errors).toEqual([]);
});

test("overlapping triggers serialize, include appended entries and redact output", async () => {
  const f = fixture([entry(1), entry(2), entry(3), entry(4)]);
  let finish!: (value: string) => void;
  let calls = 0;
  const secret = "sk-" + "a".repeat(30);
  const job = f.job(async () => {
    calls++;
    return calls === 1
      ? new Promise<string>((resolve) => {
          finish = resolve;
        })
      : "Final paragraph";
  });
  const first = f.request(job);
  await Promise.resolve();
  const second = f.request(job);
  expect(second).toBe(first);
  f.read()!.entries.push(entry(5));
  finish(secret);
  await first;
  expect(calls).toBe(2);
  expect(f.writes).toEqual(["4", "5"]);
  expect(f.read()?.summary).toBe("Final paragraph");
  const output = fixture([entry(1), entry(2), entry(3), entry(4)]);
  await output.request(output.job(async () => secret + "🙂".repeat(3_000)));
  expect(output.read()?.summary).not.toContain(secret);
  expect(Array.from(output.read()!.summary!)).toHaveLength(2_000);
});

test("deleted sessions reject late writes without recreation", async () => {
  const f = fixture([entry(1), entry(2), entry(3), entry(4)]);
  await f.request(
    f.job(async () => {
      f.set(null);
      return "Too late";
    }),
  );
  expect(f.read()).toBeNull();
  expect(f.writes).toEqual([]);
});

test("failed and empty generations preserve progress and back off per account/model", async () => {
  const f = fixture([entry(1), entry(2), entry(3), entry(4)]);
  let calls = 0;
  const job = f.job(async () => {
    calls++;
    return "";
  });
  await f.request(job);
  await f.request(job);
  expect(calls).toBe(1);
  expect(f.writes).toEqual([]);
  f.advance(10 * 60_000);
  await f.request(job);
  expect(calls).toBe(2);
  f.advance(10 * 60_000);
  await f.request(job);
  expect(calls).toBe(2);
  await f.request(f.job(async () => "Another account succeeds", "other/model"));
  expect(f.read()?.summary).toBe("Another account succeeds");
  expect(f.errors).toHaveLength(2);
});
