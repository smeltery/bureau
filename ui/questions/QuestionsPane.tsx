import { useI18n } from "../i18n.tsx";
import { SecretRequestCard } from "../log-view/integrations/SecretRequestCard.tsx";
import { useState } from "react";
import { useAppState } from "../store.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { useQuestions } from "./useQuestions.ts";
import { orderQuestions, QUESTION_PRIORITY_FILTERS, readQuestionOrder, saveQuestionOrder, type QuestionPriorityFilter, type QuestionSort } from "./inbox-order.ts";

export function QuestionsPane({ agentId, onOpenAgent }: { agentId?: string; onOpenAgent?: (id: string) => void }) {
  const { t } = useI18n();
  const { sessionContext, agents } = useAppState();
  const { questions, credentials, error } = useQuestions(sessionContext?.userId, agentId);
  const [showAnswered, setShowAnswered] = useState(false);
  const [order, setOrder] = useState(readQuestionOrder);
  const nameOf = (id: string) => agents.find((agent) => agent.id === id)?.name ?? id;
  const updateOrder = (next: Partial<typeof order>) => {
    const merged = { ...order, ...next };
    setOrder(merged);
    saveQuestionOrder(merged);
  };
  const unsent = questions.filter((question) => showAnswered || question.status !== "delivered");
  // The chat's own list keeps arrival order; only the Inbox sorts and filters.
  const visible = agentId ? unsent : orderQuestions(unsent, order.sort, order.priority, nameOf);
  if (agentId && visible.length === 0 && credentials.length === 0 && !error) return null;
  return (
    <section style={{ padding: 12, display: "grid", gap: 10, maxHeight: agentId ? 240 : undefined, overflowY: agentId ? "auto" : undefined }}>
      <h4 style={{ margin: 0 }}>{t("questions.title")}</h4>
      {!agentId && (
        <>
          <p style={{ margin: 0, fontSize: 12 }}>{t("questions.hint")}</p>
          <label style={{ fontSize: 12 }}>
            <input type="checkbox" checked={showAnswered} onChange={(event) => setShowAnswered(event.target.checked)} /> {t("questions.showSent")}
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
            <select aria-label={t("questions.sortLabel")} value={order.sort} onChange={(event) => updateOrder({ sort: event.target.value as QuestionSort })}>
              <option value="age">{t("questions.sortAge")}</option>
              <option value="priority">{t("questions.sortPriority")}</option>
              <option value="agent">{t("questions.sortAgent")}</option>
            </select>
            <select aria-label={t("questions.priorityLabel")} value={order.priority} onChange={(event) => updateOrder({ priority: event.target.value as QuestionPriorityFilter })}>
              {QUESTION_PRIORITY_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? t("questions.priorityAll") : value === "none" ? t("questions.priorityNone") : value}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 12 }}>
          {error}
        </p>
      )}
      {credentials.map((card) => (
        <SecretRequestCard key={card.id} card={card} />
      ))}
      {visible.map((question) => (
        <QuestionCard key={`${question.id}:${question.status}`} question={question} onOpenAgent={onOpenAgent ? () => onOpenAgent(question.agentId) : undefined} agentName={nameOf(question.agentId)} />
      ))}
      {!agentId && !error && visible.length === 0 && credentials.length === 0 && <p style={{ margin: 0, fontSize: 12 }}>{t("questions.empty")}</p>}
    </section>
  );
}
