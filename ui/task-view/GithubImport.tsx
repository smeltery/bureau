import { useState, type FormEvent } from "react";
import { useI18n } from "../i18n.tsx";
import { useAppState } from "../store.tsx";
import { taskFailure, taskResponse, type TaskFailure } from "./request.ts";

type Outcome = { created: number; closed: number; reopened: number };

const fieldStyle = { padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)", fontSize: 12 } as const;
const buttonStyle = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid var(--border-medium)",
  background: "var(--btn-surface)",
  color: "var(--text-primary)",
  fontSize: 12,
  cursor: "pointer",
} as const;

// Import a public repository's issues into the board the view would create
// tasks in. Running it again adds new issues and follows closes and reopens.
export function GithubImport({ roomId }: { roomId: string }) {
  const { t } = useI18n();
  const { sessionContext } = useAppState();
  const [repo, setRepo] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<TaskFailure | null>(null);
  if (!sessionContext) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const response = await taskResponse("/api/tasks/import/github", "tasks.github.failed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, label, ...(roomId ? { roomId } : {}) }),
      });
      setOutcome(await response.json());
    } catch (err) {
      setError(taskFailure(err, "tasks.github.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details style={{ padding: "8px 20px" }}>
      <summary>{t("tasks.github.title")}</summary>
      <form onSubmit={(event) => void submit(event)} onKeyDown={(event) => event.stopPropagation()} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 8 }}>
        <input required value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="owner/name" aria-label={t("tasks.github.repo")} style={{ ...fieldStyle, flex: "1 1 180px" }} />
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={t("tasks.github.labelHint")}
          aria-label={t("tasks.github.label")}
          style={{ ...fieldStyle, flex: "1 1 120px" }}
        />
        <button type="submit" disabled={busy || !repo.trim()} style={buttonStyle}>
          {t(busy ? "tasks.github.importing" : "tasks.github.import")}
        </button>
      </form>
      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-dim)" }}>{t("tasks.github.hint")}</p>
      {error && (
        <p role="alert" style={{ margin: "6px 0 0", fontSize: 12, color: "var(--red)" }}>
          {typeof error === "string" ? error : t(error.key)}
        </p>
      )}
      {outcome && (
        <p role="status" style={{ margin: "6px 0 0", fontSize: 12 }}>
          {t("tasks.github.done", { created: outcome.created, closed: outcome.closed, reopened: outcome.reopened })}
        </p>
      )}
    </details>
  );
}
