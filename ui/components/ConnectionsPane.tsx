import { useEffect, useState } from "react";
import type { ProviderAccountWire, ProviderAccountsWire, ProviderKeysUpdateRes } from "../../shared/provider-accounts.ts";
import { sectionHeader } from "./AccessPane.tsx";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "./modals/dialog-styles.ts";

class ApiError extends Error {}

export function ConnectionsPane({ username }: { username: string }) {
  const [accounts, setAccounts] = useState<ProviderAccountWire[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load(refresh = false) {
    setRefreshing(refresh);
    setError(null);
    try {
      const result = await apiFetch<ProviderAccountsWire>(refresh ? "POST" : "GET", refresh ? "/api/me/provider-accounts/refresh" : "/api/me/provider-accounts");
      setAccounts(result.accounts);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not check provider connections");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load(false);
  }, []);

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h4 style={sectionHeader}>Connections</h4>
        <button type="button" style={dialogCancelBtn} disabled={refreshing} onClick={() => void load(true)}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p style={dialogHint}>
        Claude and Codex auth for agents you spawn. Paste an API key here (saved to your personal variables as {username}), or sign in with the CLI on the Bureau host. Office-wide keys live under
        Office variables.
      </p>
      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 12 }}>
          {error}
        </p>
      )}
      {accounts.map((account) => (
        <ProviderConnectionCard key={account.provider} account={account} onUpdated={setAccounts} />
      ))}
      {accounts.length === 0 && !error && <p style={dialogHint}>Loading…</p>}
    </div>
  );
}

function ProviderConnectionCard({ account, onUpdated }: { account: ProviderAccountWire; onUpdated: (accounts: ProviderAccountWire[]) => void }) {
  const title = account.provider === "claude" ? "Claude" : "Codex";
  const keyName = account.provider === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const [keyValue, setKeyValue] = useState("");
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const status =
    account.accountStatus === "connected" ? (account.accountLabel ? `Connected (${account.accountLabel})` : "Connected") : account.accountStatus === "unavailable" ? "Unavailable" : "Not connected";

  async function saveKey() {
    setPending(true);
    setLocalError(null);
    setSavedNote(null);
    try {
      const body = account.provider === "claude" ? { anthropicApiKey: keyValue } : { openaiApiKey: keyValue };
      const result = await apiFetch<ProviderKeysUpdateRes>("PUT", "/api/me/provider-accounts/keys", body);
      // Never leave a pasted secret in the input after a successful write.
      setKeyValue("");
      onUpdated(result.accounts);
      setSavedNote(keyValue.trim() ? `${keyName} saved. Use /clear on affected agents.` : `${keyName} cleared.`);
    } catch (caught) {
      setLocalError(caught instanceof ApiError ? caught.message : "Could not save API key");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      style={{
        marginTop: 14,
        padding: "12px 0 0",
        borderTop: "1px solid var(--border-subtle)",
      }}
    >
      <h5 style={{ margin: "0 0 8px", fontSize: 13 }}>{title}</h5>
      <p style={{ ...dialogHint, margin: "0 0 8px" }}>
        <strong>Status:</strong> {status}
        {account.hasApiKey ? " · API key present" : ""}
        {account.provider === "claude" && account.cliInstalled === false ? " · Claude CLI not on PATH" : ""}
      </p>
      {account.error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 12 }}>
          {account.error}
        </p>
      )}

      <label style={dialogLabel}>
        {keyName}
        <input
          type="password"
          autoComplete="off"
          value={keyValue}
          placeholder={account.hasApiKey ? "•••••••• (enter new value to replace)" : "Paste API key"}
          style={{ ...dialogInput, marginTop: 4 }}
          onChange={(event) => setKeyValue(event.target.value)}
        />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        <button type="button" style={dialogSaveBtn} disabled={pending || !keyValue.trim()} onClick={() => void saveKey()}>
          {pending ? "Saving…" : "Save API key"}
        </button>
        {account.hasApiKey && (
          <button type="button" style={dialogCancelBtn} disabled={pending} onClick={() => void clearKey()}>
            Clear key
          </button>
        )}
      </div>
      {localError && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 12, marginTop: 8 }}>
          {localError}
        </p>
      )}
      {savedNote && <p style={{ ...dialogHint, marginTop: 8 }}>{savedNote}</p>}

      <p style={{ ...dialogHint, marginTop: 12 }}>
        Or sign in with the CLI on the Bureau host
        {account.provider === "claude" ? " (`claude`, then `/login`)" : ""}, then `/clear` the agent:
      </p>
      <ul style={{ ...dialogHint, margin: "4px 0 0", paddingLeft: 18 }}>
        {account.hostHints.map((hint) => (
          <li key={hint} style={{ marginBottom: 4 }}>
            <code style={{ fontSize: 11 }}>{hint}</code>
          </li>
        ))}
      </ul>
    </section>
  );

  async function clearKey() {
    setPending(true);
    setLocalError(null);
    setSavedNote(null);
    try {
      const body = account.provider === "claude" ? { anthropicApiKey: "" } : { openaiApiKey: "" };
      const result = await apiFetch<ProviderKeysUpdateRes>("PUT", "/api/me/provider-accounts/keys", body);
      setKeyValue("");
      onUpdated(result.accounts);
      setSavedNote(`${keyName} cleared.`);
    } catch (caught) {
      setLocalError(caught instanceof ApiError ? caught.message : "Could not clear API key");
    } finally {
      setPending(false);
    }
  }
}

async function apiFetch<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    throw new ApiError(parsed?.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}
