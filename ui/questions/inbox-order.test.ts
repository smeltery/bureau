import { expect, test } from "bun:test";
import type { MemberQuestion } from "../../shared/questions/types.ts";
import { orderQuestions } from "./inbox-order.ts";

const q = (id: string, createdAt: number, agentId: string, priority?: MemberQuestion["priority"]): MemberQuestion => ({
  id,
  agentId,
  memberUserId: "m",
  sessionId: null,
  createdAt,
  updatedAt: createdAt,
  revision: 1,
  status: "open",
  prompt: id,
  ...(priority ? { priority } : {}),
});
const list = [q("late-p0", 30, "b", "P0"), q("early-none", 10, "c"), q("mid-p2", 20, "a", "P2"), q("early-p2", 5, "c", "P2")];
const names: Record<string, string> = { a: "Ada", b: "Bo", c: "Cy" };
const ids = (sort: Parameters<typeof orderQuestions>[1], priority: Parameters<typeof orderQuestions>[2] = "all") => orderQuestions([...list], sort, priority, (id) => names[id]!).map((x) => x.id);

test("the Inbox orders by waiting time, urgency or agent, keeping waiting order for ties", () => {
  expect(ids("age")).toEqual(["early-p2", "early-none", "mid-p2", "late-p0"]);
  expect(ids("priority")).toEqual(["late-p0", "early-p2", "mid-p2", "early-none"]);
  expect(ids("agent")).toEqual(["mid-p2", "late-p0", "early-p2", "early-none"]);
});

test("the priority filter keeps one level or the unprioritized questions", () => {
  expect(ids("age", "P2")).toEqual(["early-p2", "mid-p2"]);
  expect(ids("age", "none")).toEqual(["early-none"]);
  expect(ids("age", "P3")).toEqual([]);
});
