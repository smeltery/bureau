import { useI18n } from "../i18n.tsx";
import { questionFailure, questionFailureText, questionRequest, type QuestionFailure } from "./api.ts";
import { useState } from "react";
import type { MemberQuestion } from "../../shared/questions/types.ts";
import { dialogCancelBtn, dialogInput, dialogSaveBtn } from "../components/modals/dialog-styles.ts";
import { questionsChanged } from "./useQuestions.ts";

// A single option is a "do this, then tell me" step: a tap sends it, with any
// typed note after it.
export function singleChoiceAnswer(option: string, typed: string) {
  const note = typed.trim();
  return note && note !== option ? `${option}\n\n${note}` : option;
}

export function QuestionCard({ question, agentName, onOpenAgent }: { question: MemberQuestion; agentName: string; onOpenAgent?: () => void }) {
  const { t } = useI18n();
  const [reviewedRevision, setReviewedRevision] = useState(question.revision);
  const changed = reviewedRevision !== question.revision;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<QuestionFailure | null>(null);
  const [confirmRetry, setConfirmRetry] = useState(false);
  // `answerText` overrides the field, as when a lone option is tapped.
  async function act(action: "answer" | "dismiss" | "file-task" | "retry" | "remove", answerText = text) {
    if (busy || changed) return;
    setBusy(true);
    setError(null);
    try {
      await questionRequest(`/api/questions/${question.id}${action === "remove" ? "" : `/${action}`}`, {
        method: action === "remove" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: question.revision,
          ...(action === "answer" || action === "dismiss" || action === "file-task" ? { text: answerText } : {}),
          ...(action === "retry" ? { confirmedUncertain: confirmRetry } : {}),
        }),
      });
      questionsChanged();
    } catch (error) {
      setError(questionFailure(error, "questions.updateFailed"));
      questionsChanged();
    } finally {
      setBusy(false);
    }
  }
  function chooseOption(option: string) {
    if (question.options?.length === 1) void act("answer", singleChoiceAnswer(option, text));
    else setText(option);
  }
  return (
    <article style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "grid", gap: 8, fontSize: 12 }}>
      <strong>{t("questions.asks", { name: agentName })}</strong>
      {onOpenAgent && (
        <button type="button" style={{ ...dialogCancelBtn, justifySelf: "start" }} onClick={onOpenAgent}>
          {t("questions.openChat")}
        </button>
      )}
      <div style={{ whiteSpace: "pre-wrap" }}>{question.prompt}</div>
      {changed && (
        <div role="status">
          {t("questions.changed")}{" "}
          <button type="button" style={dialogCancelBtn} onClick={() => setReviewedRevision(question.revision)}>
            {t("questions.reviewed")}
          </button>
        </div>
      )}
      {question.link && (
        <a href={question.link} target="_blank" rel="noopener noreferrer">
          {t("questions.related")}
        </a>
      )}
      {question.status === "open" ? (
        <>
          {question.options && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {question.options.map((option) => (
                <button key={option} type="button" disabled={busy || (changed && question.options!.length === 1)} style={dialogCancelBtn} onClick={() => chooseOption(option)}>
                  {option === question.recommended ? t("questions.recommended", { option }) : option}
                </button>
              ))}
            </div>
          )}
          <label>
            {t("questions.answer")}
            <textarea value={text} maxLength={8000} disabled={busy} onChange={(event) => setText(event.target.value)} style={{ ...dialogInput, minHeight: 60 }} />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" disabled={busy || changed || !text.trim()} style={dialogSaveBtn} onClick={() => void act("answer")}>
              {t("questions.send")}
            </button>
            <button type="button" disabled={busy || changed} style={dialogCancelBtn} onClick={() => void act("dismiss")}>
              {t(text.trim() ? "questions.dismissReason" : "questions.dismiss")}
            </button>
            <button type="button" disabled={busy || changed} style={dialogCancelBtn} onClick={() => void act("file-task")}>
              {t("questions.fileAsTask")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {question.answer?.taskId ? t("questions.filedAsTask", { id: question.answer.taskId }) : t(question.answer?.dismissed ? "questions.dismissed" : "questions.answer")}
            {question.answer?.text ? `: ${question.answer.text}` : ""}
          </p>
          <p style={{ margin: 0 }}>
            {question.status === "delivered" ? t("questions.delivered") : question.status === "failed" ? question.answer?.error || t("questions.refused") : t("questions.uncertain")}
          </p>
          {question.status === "uncertain" && (
            <label>
              <input type="checkbox" checked={confirmRetry} onChange={(event) => setConfirmRetry(event.target.checked)} /> {t("questions.confirmRetry")}
            </label>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(question.status === "failed" || question.status === "uncertain") && (
              <button type="button" disabled={busy || (question.status === "uncertain" && !confirmRetry)} style={dialogSaveBtn} onClick={() => void act("retry")}>
                {t("questions.retry")}
              </button>
            )}
            <button type="button" disabled={busy || question.status === "delivering"} style={dialogCancelBtn} onClick={() => void act("remove")}>
              {t("questions.remove")}
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, color: "var(--red)" }}>
          {questionFailureText(error, t)}
        </p>
      )}
    </article>
  );
}
