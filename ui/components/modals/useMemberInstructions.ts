import { useEffect, useState } from "react";

interface Snapshot {
  memberPrompt: string | null;
  memberPromptVersion: string;
}

export function useMemberInstructions(username: string, initial: string | null) {
  const [content, setContent] = useState(initial ?? "");
  const [baseline, setBaseline] = useState(initial ?? "");
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/api/users/${encodeURIComponent(username)}/member-prompt`;
  useEffect(() => {
    let cancelled = false;
    void fetch(path)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to read instructions");
        if (cancelled) return;
        setVersion(data.memberPromptVersion);
        if ((data.memberPrompt ?? "") !== (initial ?? "")) {
          setCurrent(data.memberPrompt ?? "");
          setError("Instructions changed elsewhere. Review the current text before saving your draft.");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
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
        setError("Instructions changed elsewhere. Your draft is preserved. Review the current text, then save again.");
        return false;
      }
      if (!response.ok) throw new Error(data.error ?? "Unable to save instructions");
      const saved = data as Snapshot;
      setVersion(saved.memberPromptVersion);
      setContent(saved.memberPrompt ?? "");
      setBaseline(saved.memberPrompt ?? "");
      setCurrent(null);
      setError(null);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { content, setContent, dirty: content !== baseline, busy, ready: version !== null, error, current, save };
}
