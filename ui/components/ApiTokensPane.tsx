import { useI18n } from "../i18n.tsx";
import { translatorFor, type PlainMessageKey, type Translator } from "../../shared/i18n/translate.ts";
import { useEffect, useState } from "react";
import type { ApiTokenWire } from "../../shared/types.ts";
import { dialogInput, dialogLabel, dialogSaveBtn } from "./modals/dialog-styles.ts";
import { sectionHeader } from "./AccessPane.tsx";
import { cardStyle, hint, subsectionHeader } from "./AccessPaneShared.tsx";

type TokenFailure = string | { key: PlainMessageKey };
class TokenRequestError extends Error {
  constructor(readonly failure: TokenFailure) {
    super(typeof failure === "string" ? failure : translatorFor("en").t(failure.key));
  }
}
function tokenFailure(error: unknown, key: PlainMessageKey): TokenFailure {
  return error instanceof TokenRequestError ? error.failure : error instanceof Error ? error.message : { key };
}
function failureText(error: TokenFailure, t: Translator["t"]): string {
  return typeof error === "string" ? error : t(error.key);
}
async function request<T>(path: string, key: PlainMessageKey, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new TokenRequestError(body.error ? String(body.error) : { key });
  return body as T;
}
const EXPIRIES = [
  { label: "apiTokens.month", value: 30 },
  { label: "apiTokens.year", value: 365 },
  { label: "apiTokens.never", value: null },
] as const;

export function ApiTokensPane() {
  const { t, language } = useI18n();
  const [tokens, setTokens] = useState<ApiTokenWire[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<TokenFailure | null>(null);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number | null>(30);
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

  async function load() {
    setError(null);
    try {
      const body = await request<{ apiTokens?: ApiTokenWire[] }>("/api/api-tokens", "apiTokens.loadFailed");
      setTokens(Array.isArray(body.apiTokens) ? body.apiTokens : []);
    } catch (caught) {
      setError(tokenFailure(caught, "apiTokens.loadFailed"));
    } finally {
      setLoaded(true);
    }
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
    try {
      const body = await request<{ token: string; apiToken: ApiTokenWire }>("/api/api-tokens", "apiTokens.mintFailed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, expiresInDays }),
      });
      setMinted(body.token);
      setName("");
      setTokens((current) => [body.apiToken, ...current]);
    } catch (caught) {
      setError(tokenFailure(caught, "apiTokens.mintFailed"));
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await request(`/api/api-tokens/${encodeURIComponent(id)}`, "apiTokens.revokeFailed", { method: "DELETE" });
      setTokens((current) => current.filter((token) => token.id !== id));
    } catch (caught) {
      setError(tokenFailure(caught, "apiTokens.revokeFailed"));
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>{t("apiTokens.title")}</h4>
      <p style={hint}>{t("apiTokens.intro")}</p>
      <label style={{ ...dialogLabel, marginTop: 14 }}>{t("apiTokens.howTo")}</label>
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
        {`# ${t("apiTokens.listComment")}
curl ${window.location.origin}/api/agents -H "Authorization: Bearer <token>"

# ${t("apiTokens.messageComment")}
curl -X POST ${window.location.origin}/api/agents/<id>/messages \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: send-1" \\
  -d '{"text":"..."}'

# ${t("apiTokens.drainComment")}
curl -X POST ${window.location.origin}/api/me/api-token-inbox/drain \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"after":0}'`}
      </pre>

      <div style={cardStyle}>
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 64))} aria-label={t("apiTokens.name")} placeholder={t("apiTokens.name")} style={dialogInput} />
          <select
            aria-label={t("apiTokens.expiry")}
            value={expiresInDays === null ? "never" : String(expiresInDays)}
            onChange={(e) => setExpiresInDays(e.target.value === "never" ? null : Number(e.target.value))}
            style={dialogInput}
          >
            {EXPIRIES.map((expiry) => (
              <option key={expiry.label} value={expiry.value === null ? "never" : expiry.value}>
                {t(expiry.label)}
              </option>
            ))}
          </select>
          <button onClick={mint} disabled={pending || !name.trim()} style={{ ...dialogSaveBtn, opacity: pending || !name.trim() ? 0.5 : 1 }}>
            {pending ? t("apiTokens.creating") : t("apiTokens.create")}
          </button>
        </div>
        {minted && (
          <div style={{ marginTop: 12, padding: 10, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-input)" }}>
            <strong style={{ fontSize: 12 }}>{t("apiTokens.copyNow")}</strong>
            <p style={hint}>{t("apiTokens.shownOnce")}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <code style={{ flex: 1, minWidth: 0, fontFamily: "monospace", fontSize: 12, overflowWrap: "anywhere", userSelect: "all" }}>{minted}</code>
              <button
                onClick={async () => {
                  setError(null);
                  setCopied(false);
                  try {
                    await navigator.clipboard.writeText(minted);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    setError({ key: "apiTokens.copyFailed" });
                  }
                }}
                style={{ ...dialogSaveBtn, flexShrink: 0 }}
              >
                {copied ? t("common.copied") : t("common.copy")}
              </button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" style={{ fontSize: 11, color: "#ff6b6b", margin: "8px 0 0" }}>
            {failureText(error, t)}
          </p>
        )}
      </div>

      <h5 style={subsectionHeader}>{t("apiTokens.active")}</h5>
      {!loaded ? (
        <p style={hint}>{t("common.loadingDots")}</p>
      ) : tokens.length === 0 ? (
        <p style={hint}>{t("apiTokens.empty")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {tokens.map((token) => (
            <div key={token.id} style={{ ...cardStyle, display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{token.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-ghost)" }}>
                  {t("apiTokens.details", {
                    prefix: token.tokenPrefix,
                    expiry: token.expiresAt === null ? t("common.never") : new Date(token.expiresAt).toLocaleDateString(language),
                    used: token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString(language) : t("common.never"),
                  })}
                </div>
              </div>
              <button onClick={() => void revoke(token.id)} style={{ ...dialogSaveBtn, background: "var(--red, #f85149)" }}>
                {t("apiTokens.revoke")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MemberApiTokens({ username }: { username: string }) {
  const { t, language } = useI18n();
  const [tokens, setTokens] = useState<ApiTokenWire[] | null>(null);
  const [error, setError] = useState<TokenFailure | null>(null);
  const base = `/api/users/${encodeURIComponent(username)}/api-tokens`;

  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    setError(null);
    request<{ apiTokens?: ApiTokenWire[] }>(base, "apiTokens.loadFailed")
      .then((body) => {
        if (!cancelled) setTokens(Array.isArray(body.apiTokens) ? body.apiTokens : []);
      })
      .catch((caught) => {
        if (!cancelled) setError(tokenFailure(caught, "apiTokens.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  async function revoke(id: string) {
    setError(null);
    try {
      await request(`${base}/${encodeURIComponent(id)}`, "apiTokens.revokeFailed", { method: "DELETE" });
      setTokens((current) => (current ?? []).filter((token) => token.id !== id));
    } catch (caught) {
      setError(tokenFailure(caught, "apiTokens.revokeFailed"));
    }
  }

  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 12, marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 6 }}>{t("apiTokens.memberTitle")}</div>
      {tokens === null && !error && <p style={hint}>{t("common.loadingDots")}</p>}
      {tokens?.length === 0 && <p style={hint}>{t("apiTokens.empty")}</p>}
      {tokens?.map((token) => (
        <div key={token.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", marginTop: 6 }}>
          <div style={{ minWidth: 0, fontSize: 11, color: "var(--text-ghost)" }}>
            <strong style={{ color: "var(--text-primary)" }}>{token.name}</strong> ·{" "}
            {t("apiTokens.memberDetails", { prefix: token.tokenPrefix, used: token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString(language) : t("common.never") })}
          </div>
          <button onClick={() => void revoke(token.id)} style={{ ...dialogSaveBtn, background: "var(--red, #f85149)" }}>
            {t("apiTokens.revoke")}
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" style={{ fontSize: 11, color: "#ff6b6b", margin: "6px 0 0" }}>
          {failureText(error, t)}
        </p>
      )}
    </div>
  );
}
