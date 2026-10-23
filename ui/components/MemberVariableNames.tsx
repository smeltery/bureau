import { useI18n } from "../i18n.tsx";
import { useEffect, useState } from "react";

class VariableNamesError extends Error {
  constructor(readonly status: number) {
    super(`Request failed (${status})`);
  }
}

export function MemberVariableNames({ username }: { username: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; names: string[] } | { kind: "error"; message: string | null; status?: number }>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/users/${encodeURIComponent(username)}/env/names`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw body?.error ? new Error(body.error) : new VariableNamesError(res.status);
        return Array.isArray(body?.names) ? body.names.filter((name: unknown) => typeof name === "string") : [];
      })
      .then((names) => {
        if (!cancelled) setState({ kind: "ready", names });
      })
      .catch((caught) => {
        if (!cancelled)
          setState(caught instanceof VariableNamesError ? { kind: "error", message: null, status: caught.status } : { kind: "error", message: caught instanceof Error ? caught.message : null });
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const detail =
    state.kind === "loading"
      ? t("profile.variablesLoading")
      : state.kind === "error"
        ? state.status !== undefined
          ? t("common.requestFailed", { status: state.status })
          : (state.message ?? t("integrations.variablesLoadFailed"))
        : state.names.length
          ? state.names.join(", ")
          : t("profile.variablesEmpty");

  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 12, marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 6 }}>{t("profile.variablesTitle")}</div>
      <p style={{ fontSize: 11, color: state.kind === "error" ? "var(--red)" : "var(--text-ghost)", margin: 0, lineHeight: 1.4 }}>{detail}</p>
    </div>
  );
}
