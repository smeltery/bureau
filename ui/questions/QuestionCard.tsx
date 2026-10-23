import { useState } from "react";
import type { MemberQuestion } from "../../shared/questions/types.ts";
import { dialogCancelBtn, dialogInput, dialogSaveBtn } from "../components/modals/dialog-styles.ts";
import { questionsChanged } from "./useQuestions.ts";

export function QuestionCard({ question, agentName, onOpenAgent }: { question: MemberQuestion; agentName: string; onOpenAgent?: () => void }) {
  const [reviewedRevision, setReviewedRevision] = useState(question.revision);
  const changed = reviewedRevision !== question.revision;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRetry, setConfirmRetry] = useState(false);
  async function act(action: "answer" | "dismiss" | "retry" | "remove") {
    if (busy || changed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/questions/${question.id}${action === "remove" ? "" : `/${action}`}`, {
        method: action === "remove" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: question.revision, ...(action === "answer" || action === "dismiss" ? { text } : {}), ...(action === "retry" ? { confirmedUncertain: confirmRetry } : {}) }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Could not update this question");
      }
      questionsChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update this question");
      questionsChanged();
    } finally {
      setBusy(false);
    }
  }
  return (
    <article style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "grid", gap: 8, fontSize: 12 }}>
      <strong>{agentName} asks</strong>
      {onOpenAgent && (
        <button type="button" style={{ ...dialogCancelBtn, justifySelf: "start" }} onClick={onOpenAgent}>
          Open conversation
        </button>
      )}
      <div style={{ whiteSpace: "pre-wrap" }}>{question.prompt}</div>
      {changed && (
        <div role="status">
          This question was updated. Your draft is kept.{" "}
          <button type="button" style={dialogCancelBtn} onClick={() => setReviewedRevision(question.revision)}>
            I reviewed the updated question
          </button>
        </div>
      )}
      {question.link && (
        <a href={question.link} target="_blank" rel="noopener noreferrer">
          Open related page
        </a>
      )}
      {question.status === "open" ? (
        <>
          {question.options && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {question.options.map((option) => (
                <button key={option} type="button" disabled={busy} style={dialogCancelBtn} onClick={() => setText(option)}>
                  {option}
                  {option === question.recommended ? " (recommended)" : ""}
                </button>
              ))}
            </div>
          )}
          <label>
            Your answer
            <textarea value={text} maxLength={8000} disabled={busy} onChange={(event) => setText(event.target.value)} style={{ ...dialogInput, minHeight: 60 }} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={busy || changed || !text.trim()} style={dialogSaveBtn} onClick={() => void act("answer")}>
              Send answer
            </button>
            <button type="button" disabled={busy || changed} style={dialogCancelBtn} onClick={() => void act("dismiss")}>
              Dismiss{text.trim() ? " with this reason" : ""}
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {question.answer?.dismissed ? "Dismissed" : "Your answer"}
            {question.answer?.text ? `: ${question.answer.text}` : ""}
          </p>
          <p style={{ margin: 0 }}>
            {question.status === "delivered"
              ? "Accepted by the agent's message queue."
              : question.status === "failed"
                ? question.answer?.error || "Delivery was refused. Your answer is saved."
                : "Your answer is saved, but delivery could not be confirmed. Check the conversation before retrying."}
          </p>
          {question.status === "uncertain" && (
            <label>
              <input type="checkbox" checked={confirmRetry} onChange={(event) => setConfirmRetry(event.target.checked)} /> I checked the conversation and want to resend.
            </label>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {(question.status === "failed" || question.status === "uncertain") && (
              <button type="button" disabled={busy || (question.status === "uncertain" && !confirmRetry)} style={dialogSaveBtn} onClick={() => void act("retry")}>
                Retry saved answer
              </button>
            )}
            <button type="button" disabled={busy || question.status === "delivering"} style={dialogCancelBtn} onClick={() => void act("remove")}>
              Remove from inbox
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, color: "var(--red)" }}>
          {error}
        </p>
      )}
    </article>
  );
}
