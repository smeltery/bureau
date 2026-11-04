import type { MemberQuestion } from "../../shared/questions/types.ts";
import type { TaskPriority } from "../../shared/tasks.ts";
import { storageGetItem, storageSetItem } from "../browser-storage.ts";

// How the Inbox orders and narrows questions, remembered per browser.
export type QuestionSort = "age" | "priority" | "agent";
export type QuestionPriorityFilter = "all" | "none" | TaskPriority;

const KEY = "bureau-inbox-question-order";
const SORTS: QuestionSort[] = ["age", "priority", "agent"];
const FILTERS: QuestionPriorityFilter[] = ["all", "P0", "P1", "P2", "P3", "none"];

export function readQuestionOrder(): { sort: QuestionSort; priority: QuestionPriorityFilter } {
  let saved: { sort?: unknown; priority?: unknown } = {};
  try {
    saved = JSON.parse(storageGetItem(KEY) ?? "{}") ?? {};
  } catch {
    // A damaged value falls back to the defaults.
  }
  return {
    sort: SORTS.includes(saved.sort as QuestionSort) ? (saved.sort as QuestionSort) : "age",
    priority: FILTERS.includes(saved.priority as QuestionPriorityFilter) ? (saved.priority as QuestionPriorityFilter) : "all",
  };
}

export function saveQuestionOrder(order: { sort: QuestionSort; priority: QuestionPriorityFilter }): void {
  storageSetItem(KEY, JSON.stringify(order));
}

export const QUESTION_PRIORITY_FILTERS = FILTERS;

// Longest waiting first; "priority" puts P0 first and unprioritized last;
// ties keep the longest-waiting order.
export function orderQuestions(questions: MemberQuestion[], sort: QuestionSort, priority: QuestionPriorityFilter, agentName: (id: string) => string): MemberQuestion[] {
  const kept = questions.filter((q) => priority === "all" || (priority === "none" ? !q.priority : q.priority === priority));
  const rank = (q: MemberQuestion) => (q.priority ? Number(q.priority.slice(1)) : 4);
  return kept.sort((a, b) => {
    if (sort === "priority" && rank(a) !== rank(b)) return rank(a) - rank(b);
    if (sort === "agent") {
      const byName = agentName(a.agentId).localeCompare(agentName(b.agentId));
      if (byName) return byName;
    }
    return a.createdAt - b.createdAt;
  });
}
