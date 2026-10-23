import type { SecretRequestCard } from "../../shared/integrations/secret-requests.ts";
import { useCallback, useEffect, useState } from "react";
import type { MemberQuestion } from "../../shared/questions/types.ts";

export function questionsChanged() {
  window.dispatchEvent(new Event("bureau-questions-changed"));
}
export function useQuestions(userId: string | undefined, agentId?: string) {
  const enabled = !!userId;
  const [rows, setRows] = useState<MemberQuestion[]>([]);
  const [credentials, setCredentials] = useState<SecretRequestCard[]>([]);
  const [credentialUser, setCredentialUser] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [generation, refresh] = useState(0);
  const reload = useCallback(() => refresh((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) {
      setRows([]);
      return;
    }
    const controller = new AbortController();
    async function read(path: string) {
      const response = await fetch(path, { signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load inbox");
      return body;
    }
    Promise.all([read(`/api/questions${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`), read("/api/integrations/requests")])
      .then(([questions, requests]) => {
        if (!controller.signal.aborted) {
          setRows(questions.questions);
          setCredentials(requests.requests);
          setCredentialUser(userId);
          setError(null);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setRows([]);
          setCredentials([]);
          setError(error.message);
        }
      });
    return () => controller.abort();
  }, [enabled, userId, agentId, generation]);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(reload, 10_000);
    window.addEventListener("focus", reload);
    window.addEventListener("bureau-questions-changed", reload);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", reload);
      window.removeEventListener("bureau-questions-changed", reload);
    };
  }, [enabled, reload]);
  return {
    credentials: enabled && credentialUser === userId ? credentials.filter((card) => !agentId || card.agentId === agentId) : [],
    questions: enabled ? rows.filter((row) => row.memberUserId === userId && (!agentId || row.agentId === agentId)) : [],
    error,
    reload,
  };
}
