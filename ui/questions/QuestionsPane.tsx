import { SecretRequestCard } from "../log-view/integrations/SecretRequestCard.tsx";
import { useState } from "react";
import { useAppState } from "../store.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { useQuestions } from "./useQuestions.ts";

export function QuestionsPane({ agentId, onOpenAgent }: { agentId?: string; onOpenAgent?: (id: string) => void }) {
  const { sessionContext, agents } = useAppState();
  const { questions, credentials, error } = useQuestions(sessionContext?.userId, agentId);
  const [showAnswered, setShowAnswered] = useState(false);
  const visible = questions.filter((question) => showAnswered || question.status !== "delivered");
  if (agentId && visible.length === 0 && credentials.length === 0 && !error) return null;
  return (
    <section style={{ padding: 12, display: "grid", gap: 10, maxHeight: agentId ? 240 : undefined, overflowY: agentId ? "auto" : undefined }}>
      <h4 style={{ margin: 0 }}>Questions for you</h4>
      {!agentId && (
        <>
          <p style={{ margin: 0, fontSize: 12 }}>These questions can wait. Answer or dismiss them when you have time; urgent pages appear below.</p>
          <label style={{ fontSize: 12 }}>
            <input type="checkbox" checked={showAnswered} onChange={(event) => setShowAnswered(event.target.checked)} /> Show sent answers
          </label>
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
        <QuestionCard
          key={`${question.id}:${question.status}`}
          question={question}
          onOpenAgent={onOpenAgent ? () => onOpenAgent(question.agentId) : undefined}
          agentName={agents.find((agent) => agent.id === question.agentId)?.name ?? question.agentId}
        />
      ))}
      {!agentId && !error && visible.length === 0 && credentials.length === 0 && <p style={{ margin: 0, fontSize: 12 }}>No questions waiting for you.</p>}
    </section>
  );
}
