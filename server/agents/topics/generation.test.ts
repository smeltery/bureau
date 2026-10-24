import { expect, test } from "bun:test";
import type { LogEntry } from "../../../shared/types.ts";
import { createTopicGenerator, normalizeTopic, type TopicRequest } from "./generation.ts";

function deferred() {
  let resolve!: (label: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const target = { topic: "Earlier topic" as string | null, generating: false, count: 0 };
  let errors = 0;
  let now = 0;
  const generator = createTopicGenerator<typeof target>({
    generating: (state, value) => {
      state.generating = value;
    },
    apply: (state, topic, count) => {
      state.topic = topic;
      state.count = count;
    },
    onError: () => {
      errors++;
    },
    now: () => now,
  });
  const entries: LogEntry[] = [{ id: "prompt", agentId: "agent", timestamp: 1, kind: "user_message", content: "Fix the deployment" }];
  const request = (generate: TopicRequest["generate"], options: Partial<TopicRequest> = {}): TopicRequest => ({
    topic: target.topic,
    manual: true,
    entries,
    scope: "account-a",
    isCurrent: () => true,
    generate,
    ...options,
  });
  return {
    target,
    generator,
    request,
    entries,
    errors: () => errors,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("refresh keeps its label until success and preserves it on failure or empty history", async () => {
  const f = fixture();
  const reply = deferred();
  const running = f.generator.generate(
    f.target,
    f.request(() => reply.promise),
  );
  expect(f.target).toMatchObject({ topic: "Earlier topic", generating: true });
  reply.resolve("Updated deployment");
  await running;
  expect(f.target).toEqual({ topic: "Updated deployment", generating: false, count: 1 });
  await f.generator.generate(
    f.target,
    f.request(async () => {
      throw new Error("Unavailable");
    }),
  );
  expect(f.target).toMatchObject({ topic: "Updated deployment", generating: false });
  await f.generator.generate(
    f.target,
    f.request(async () => "Must not run", { entries: [] }),
  );
  expect(f.target.topic).toBe("Updated deployment");
});

test("manual edits invalidate old results and old completions cannot clear a newer flag", async () => {
  const f = fixture();
  const old = deferred();
  const fresh = deferred();
  const first = f.generator.generate(
    f.target,
    f.request(() => old.promise),
  );
  f.generator.invalidate(f.target);
  f.target.topic = "Typed label";
  const second = f.generator.generate(
    f.target,
    f.request(() => fresh.promise),
  );
  old.resolve("Outdated label");
  await first;
  expect(f.target).toMatchObject({ topic: "Typed label", generating: true });
  fresh.resolve("Fresh label");
  await second;
  expect(f.target).toMatchObject({ topic: "Fresh label", generating: false });
});

test("session changes reject stale results and concurrent requests coalesce", async () => {
  const f = fixture();
  let current = true;
  let calls = 0;
  const reply = deferred();
  const request = f.request(
    () => {
      calls++;
      return reply.promise;
    },
    { isCurrent: () => current },
  );
  const first = f.generator.generate(f.target, request);
  await f.generator.generate(f.target, request);
  expect(calls).toBe(1);
  current = false;
  reply.resolve("Wrong session");
  await first;
  expect(f.target).toMatchObject({ topic: "Earlier topic", generating: false });
});

test("automatic generation fills only empty topics and backs off per account", async () => {
  const f = fixture();
  let calls = 0;
  const fail = async () => {
    calls++;
    throw new Error("Unavailable");
  };
  await f.generator.generate(f.target, f.request(fail, { manual: false }));
  expect(calls).toBe(0);
  f.target.topic = null;
  await f.generator.generate(f.target, f.request(fail, { manual: false }));
  await f.generator.generate(f.target, f.request(fail, { manual: false }));
  expect(calls).toBe(1);
  await f.generator.generate(f.target, f.request(fail, { manual: false, scope: "account-b" }));
  expect(calls).toBe(2);
  f.advance(10 * 60_000);
  await f.generator.generate(f.target, f.request(fail, { manual: false }));
  expect(calls).toBe(3);
  f.advance(10 * 60_000);
  await f.generator.generate(f.target, f.request(fail, { manual: false }));
  expect(calls).toBe(3);
  await f.generator.generate(
    f.target,
    f.request(async () => "Manual recovery"),
  );
  expect(f.target).toMatchObject({ topic: "Manual recovery" });
});

test("authentication failures do not start automatic backoff", async () => {
  const f = fixture();
  f.target.topic = null;
  const request = f.request(
    async () => {
      throw new Error("Sign in required");
    },
    { manual: false, isAuthError: () => true },
  );
  await f.generator.generate(f.target, request);
  await f.generator.generate(f.target, request);
  expect(f.errors()).toBe(2);
  expect(f.target.topic).toBeNull();
});

test("labels normalize placeholders and whitespace, and prompts and output redact secrets", async () => {
  const f = fixture();
  const secret = "sk-proj-" + "Q".repeat(24);
  f.entries[0].content = secret + "x".repeat(5_000);
  await f.generator.generate(
    f.target,
    f.request(async (prompt, system) => {
      expect(prompt).not.toContain(secret);
      expect(prompt.length).toBeLessThan(2_100);
      expect(system).toContain("Do not perform their tasks");
      return `  ${secret}\n  deployment  `;
    }),
  );
  expect(f.target.topic).not.toContain(secret);
  expect(f.target.topic).toContain("REDACTED");
  expect(normalizeTopic("  ... ")).toBeNull();
  expect(normalizeTopic(" \n ")).toBeNull();
  expect(normalizeTopic(" label \n text ")).toBe("label text");
  expect(Array.from(normalizeTopic("😀".repeat(100))!)).toHaveLength(80);
  await f.generator.generate(
    f.target,
    f.request(async () => "..."),
  );
  expect(f.errors()).toBe(1);
  expect(f.target.topic).toContain("REDACTED");
});
