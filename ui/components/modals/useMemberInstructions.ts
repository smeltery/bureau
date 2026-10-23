import { useI18n } from "../../i18n.tsx";
import { translatorFor, type PlainMessageKey } from "../../../shared/i18n/translate.ts";
import { useEffect, useState } from "react";

class InstructionsError extends Error {
  constructor(readonly key: PlainMessageKey) {
    super(translatorFor("en").t(key));
  }
}

interface Snapshot {
  memberPrompt: string | null;
  memberPromptVersion: string;
}

export function useMemberInstructions(username: string, initial: string | null) {
  const { t } = useI18n();
  const [content, setContent] = useState(initial ?? "");
  const [baseline, setBaseline] = useState(initial ?? "");
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | { key: PlainMessageKey } | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/api/users/${encodeURIComponent(username)}/member-prompt`;
  useEffect(() => {
    let cancelled = false;
    void fetch(path)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw data.error == null ? new InstructionsError("profile.readInstructions") : new Error(data.error);
        if (cancelled) return;
        setVersion(data.memberPromptVersion);
        if ((data.memberPrompt ?? "") !== (initial ?? "")) {
          setCurrent(data.memberPrompt ?? "");
          setError({ key: "profile.instructionsChanged" });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof InstructionsError ? { key: err.key } : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  async function save(): Promise<boolean> {
    if (content.trim() === baseline.trim()) return true;
    if (!version || busy) return false;
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberPrompt: content.trim() || null, memberPromptVersion: version }),
      });
      const data = await response.json();
      if (response.status === 409) {
        setVersion(data.memberPromptVersion);
        setCurrent(data.memberPrompt ?? "");
        setError({ key: "profile.instructionsConflict" });
        return false;
      }
      if (!response.ok) throw data.error == null ? new InstructionsError("profile.saveInstructions") : new Error(data.error);
      const saved = data as Snapshot;
      setVersion(saved.memberPromptVersion);
      setContent(saved.memberPrompt ?? "");
      setBaseline(saved.memberPrompt ?? "");
      setCurrent(null);
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof InstructionsError ? { key: err.key } : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { content, setContent, dirty: content !== baseline, busy, ready: version !== null, error: error === null ? null : typeof error === "string" ? error : t(error.key), current, save };
}
