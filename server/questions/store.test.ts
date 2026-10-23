import { expect, test } from "bun:test";
import type { MemberQuestion } from "../../shared/questions/types.ts";
import { createQuestionStore, type QuestionPersistence } from "./store.ts";

function fixture() {
  let disk: MemberQuestion[] = [],
    failWrite = false;
  const persistence: QuestionPersistence = {
    read: () => structuredClone(disk),
    write: (rows) => {
      if (failWrite) throw new Error("disk full");
      disk = structuredClone(rows);
    },
  };
  const store = createQuestionStore(persistence);
  const question = store.create({ agentId: "agent-one", memberUserId: "member-one", sessionId: "session-one" }, { prompt: "Which option?", options: ["A", "B"], recommended: "A" });
  const answer = { text: "B", dismissed: false, username: "Member", userId: "member-one" };
  return {
    store,
    question,
    answer,
    persistence,
    fail: () => {
      failWrite = true;
    },
    restore: () => {
      failWrite = false;
    },
  };
}

test("questions persist, copy their state, and reject stale edits", () => {
  const f = fixture();
  f.store.list()[0].prompt = "not persisted";
  expect(f.store.get(f.question.id).prompt).toBe("Which option?");
  const changed = f.store.edit(f.question.id, 1, { prompt: "Updated?", options: [] });
  expect(changed.revision).toBe(2);
  expect(changed.options).toBeUndefined();
  expect(changed.recommended).toBeUndefined();
  expect(() => f.store.edit(f.question.id, 1, { prompt: "stale" })).toThrow("changed");
  expect(createQuestionStore(f.persistence).get(f.question.id)).toEqual(changed);
});

test("a failed save never changes memory or starts delivery", () => {
  const f = fixture();
  f.fail();
  expect(() => f.store.edit(f.question.id, 1, { prompt: "new" })).toThrow("disk full");
  let deliveries = 0;
  expect(() =>
    f.store.answer(f.question.id, 1, f.answer, () => {
      deliveries++;
      return { ok: true };
    }),
  ).toThrow("disk full");
  expect(deliveries).toBe(0);
  expect(f.store.get(f.question.id).status).toBe("open");
  expect(f.store.get(f.question.id).prompt).toBe("Which option?");
});

test("answer receipts prevent duplicate submissions and record explicit retries", () => {
  const f = fixture();
  let deliveries = 0;
  const send = () => {
    deliveries++;
    return { ok: true as const };
  };
  const result = f.store.answer(f.question.id, 1, f.answer, send);
  expect(result.status).toBe("delivered");
  f.store.answer(f.question.id, 1, f.answer, send);
  createQuestionStore(f.persistence).answer(f.question.id, 1, f.answer, send);
  expect(deliveries).toBe(1);
  expect(() => f.store.answer(f.question.id, 1, { ...f.answer, text: "different" }, send)).toThrow("already");
  expect(() => f.store.retry(f.question.id, 1, true, send)).toThrow("does not need");
});

test("a receipt write failure preserves the answer and requires confirmation after restart", () => {
  const f = fixture();
  let deliveries = 0;
  const delivered = f.store.answer(f.question.id, 1, f.answer, (row) => {
    expect(createQuestionStore(f.persistence).get(row.id).answer?.text).toBe("B");
    f.fail();
    deliveries++;
    return { ok: true };
  });
  expect(delivered.status).toBe("delivered");
  f.store.answer(f.question.id, 1, f.answer, () => {
    deliveries++;
    return { ok: true };
  });
  expect(deliveries).toBe(1);
  f.restore();
  const restarted = createQuestionStore(f.persistence);
  expect(restarted.get(f.question.id).status).toBe("uncertain");
  expect(() => restarted.retry(f.question.id, 1, false, () => ({ ok: true }))).toThrow("Check the conversation");
  const retried = restarted.retry(f.question.id, 1, true, () => ({ ok: true }));
  expect(retried.status).toBe("delivered");
  expect(retried.answer?.attemptId).not.toBe(delivered.answer?.attemptId);
});

test("refused delivery keeps the saved answer for retry", () => {
  const f = fixture();
  const failed = f.store.answer(f.question.id, 1, f.answer, () => ({ ok: false, error: "queue full" }));
  expect(failed.status).toBe("failed");
  expect(failed.answer?.error).toBe("queue full");
  expect(f.store.retry(f.question.id, 1, false, () => ({ ok: true })).status).toBe("delivered");
});

test("invalid prompts, choices, links, recipients and corrupt storage are refused", () => {
  const f = fixture();
  for (const input of [{ prompt: "" }, { options: ["A"] }, { options: ["A", "A"] }, { recommended: "unknown" }, { link: "https://example.com" }, { link: "//example.com" }])
    expect(() => f.store.edit(f.question.id, 1, input)).toThrow();
  expect(() => f.store.answer(f.question.id, 1, { ...f.answer, userId: "someone-else" }, () => ({ ok: true }))).toThrow("addressed");
  let writes = 0;
  const broken = createQuestionStore({
    read: () => [{ id: "broken" }],
    write: () => {
      writes++;
    },
  });
  expect(() => broken.list()).toThrow("original file was kept");
  expect(writes).toBe(0);
});
