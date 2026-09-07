import { useEffect, useState } from "react";

export function MemberVariableNames({ username }: { username: string }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; names: string[] } | { kind: "error"; message: string }>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/users/${encodeURIComponent(username)}/env/names`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
        return Array.isArray(body?.names) ? body.names.filter((name: unknown) => typeof name === "string") : [];
      })
      .then((names) => {
        if (!cancelled) setState({ kind: "ready", names });
      })
      .catch((caught) => {
        if (!cancelled) setState({ kind: "error", message: caught instanceof Error ? caught.message : "Could not load variables" });
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const detail = state.kind === "loading" ? "Loading variable names..." : state.kind === "error" ? state.message : state.names.length ? state.names.join(", ") : "No managed variables set.";

  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 12, marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 6 }}>Variables this user has set</div>
      <p style={{ fontSize: 11, color: state.kind === "error" ? "var(--red)" : "var(--text-ghost)", margin: 0, lineHeight: 1.4 }}>{detail}</p>
    </div>
  );
}
