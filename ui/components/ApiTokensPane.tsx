import { useEffect, useState } from "react";
import type { ApiTokenWire } from "../../shared/types.ts";
import { dialogInput, dialogLabel, dialogSaveBtn } from "./modals/dialog-styles.ts";
import { sectionHeader } from "./AccessPane.tsx";
import { cardStyle, hint, subsectionHeader } from "./AccessPaneShared.tsx";

const EXPIRIES = [
  { label: "30 days", value: 30 },
  { label: "1 year", value: 365 },
  { label: "Never", value: null },
] as const;

export function ApiTokensPane() {
  const [tokens, setTokens] = useState<ApiTokenWire[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number | null>(30);
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

  async function load() {
    setError(null);
    const res = await fetch("/api/api-tokens");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || "Failed to load API tokens");
      setLoaded(true);
      return;
    }
    setTokens(Array.isArray(body.apiTokens) ? body.apiTokens : []);
    setLoaded(true);
  }

  useEffect(() => {
    void load();
  }, []);

  async function mint() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    setMinted(null);
    setCopied(false);
    const res = await fetch("/api/api-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, expiresInDays }),
    });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      setError(body.error || "Failed to mint API token");
      return;
    }
    setMinted(body.token);
    setName("");
    setTokens([body.apiToken, ...tokens]);
  }

  async function revoke(id: string) {
    setError(null);
    const res = await fetch(`/api/api-tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Failed to revoke API token");
      return;
    }
    setTokens(tokens.filter((token) => token.id !== id));
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>API tokens</h4>
      <p style={hint}>Create personal bearer tokens for scripts and off-device API access.</p>
      <label style={{ ...dialogLabel, marginTop: 14 }}>How to use</label>
      <pre
        style={{
          margin: "0 0 12px",
          padding: "8px 10px",
          borderRadius: 6,
          background: "var(--bg-code)",
          border: "1px solid var(--border)",
          fontSize: 11,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          color: "var(--text-secondary)",
          userSelect: "text",
        }}
      >
        {`# list your visible agents and their ids
curl ${window.location.origin}/api/agents -H "Authorization: Bearer <token>"

# message one
curl -X POST ${window.location.origin}/api/agents/<id>/messages \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"..."}'`}
      </pre>

      <div style={cardStyle}>
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 64))} placeholder="Token name" style={dialogInput} />
          <select value={expiresInDays === null ? "never" : String(expiresInDays)} onChange={(e) => setExpiresInDays(e.target.value === "never" ? null : Number(e.target.value))} style={dialogInput}>
            {EXPIRIES.map((expiry) => (
              <option key={expiry.label} value={expiry.value === null ? "never" : expiry.value}>
                {expiry.label}
              </option>
            ))}
          </select>
          <button onClick={mint} disabled={pending || !name.trim()} style={{ ...dialogSaveBtn, opacity: pending || !name.trim() ? 0.5 : 1 }}>
            {pending ? "Creating..." : "Create token"}
          </button>
        </div>
        {minted && (
          <div style={{ marginTop: 12, padding: 10, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-input)" }}>
            <strong style={{ fontSize: 12 }}>Copy this token now</strong>
            <p style={hint}>It will not be shown again.</p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <code style={{ flex: 1, minWidth: 0, fontFamily: "monospace", fontSize: 12, overflowWrap: "anywhere", userSelect: "all" }}>{minted}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(minted).then(
                    () => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    },
                    () => {},
                  );
                }}
                style={{ ...dialogSaveBtn, flexShrink: 0 }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
        {error && <p style={{ fontSize: 11, color: "#ff6b6b", margin: "8px 0 0" }}>{error}</p>}
      </div>

      <h5 style={subsectionHeader}>Active tokens</h5>
      {!loaded ? (
        <p style={hint}>Loading...</p>
      ) : tokens.length === 0 ? (
        <p style={hint}>No API tokens.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {tokens.map((token) => (
            <div key={token.id} style={{ ...cardStyle, display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{token.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-ghost)" }}>
                  {token.tokenPrefix}... · expires {token.expiresAt === null ? "never" : new Date(token.expiresAt).toLocaleDateString()} · last used{" "}
                  {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : "never"}
                </div>
              </div>
              <button onClick={() => void revoke(token.id)} style={{ ...dialogSaveBtn, background: "var(--red, #f85149)" }}>
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
