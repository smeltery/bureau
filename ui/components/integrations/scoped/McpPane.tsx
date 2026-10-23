import { useI18n } from "../../../i18n.tsx";
import { McpSignIn } from "./McpSignIn.tsx";
import { useState } from "react";
import type { RemoteMcpServer } from "../../../../shared/integrations/connections.ts";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "../../modals/dialog-styles.ts";
import { integrationFailure, integrationFailureText, type IntegrationFailure, integrationApi, type IntegrationListing } from "./api.ts";
import { ConnectionTest } from "./ConnectionTest.tsx";
export function McpPane({ path, data, reload }: { path: string; data: IntegrationListing; reload: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<RemoteMcpServer | "new" | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [oauth, setOAuth] = useState(false);
  const [note, setNote] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<IntegrationFailure | null>(null);
  const [pending, setPending] = useState(false);
  function edit(server?: RemoteMcpServer) {
    setEditing(server ?? "new");
    setName(server?.name ?? "");
    setUrl(server?.url ?? "");
    setSecret(server?.secret ?? "");
    setOAuth(server?.oauth ?? false);
    setNote(server?.note ?? "");
    setError(null);
  }
  async function save(method = "PUT", selected = name) {
    setPending(true);
    setError(null);
    try {
      await integrationApi(`${path}/mcp/${encodeURIComponent(selected)}`, method, method === "PUT" ? { url, secret: oauth ? null : secret || null, note, oauth } : undefined);
      setEditing(null);
      setDeleting(null);
      reload();
    } catch (caught) {
      setError(integrationFailure(caught, "integrations.mcpSaveFailed"));
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <p style={dialogHint}>{t("integrations.mcpHint")}</p>
      {error && <p role="alert">{integrationFailureText(error, t)}</p>}
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label style={dialogLabel}>
            {t("common.name")}
            <input required disabled={editing !== "new" || pending} style={dialogInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="project_docs" />
          </label>
          <label style={dialogLabel}>
            {t("integrations.endpoint")}
            <input required type="url" style={dialogInput} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://tools.example.com/mcp" />
          </label>
          <label style={dialogLabel}>
            {t("integrations.authentication")}
            <select value={oauth ? "oauth" : "secret"} style={dialogInput} onChange={(e) => setOAuth(e.target.value === "oauth")}>
              <option value="secret">{t("integrations.storedCredential")}</option>
              <option value="oauth">{t("integrations.oauth")}</option>
            </select>
          </label>
          <label style={dialogLabel}>
            {t("integrations.credential")}
            <select disabled={oauth} style={dialogInput} value={secret} onChange={(e) => setSecret(e.target.value)}>
              <option value="">{t("integrations.noCredential")}</option>
              {data.secrets.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <p style={dialogHint}>{oauth ? t("integrations.oauthHint") : t("integrations.credentialHint")}</p>
          <label style={dialogLabel}>
            {t("integrations.note")}
            <textarea style={dialogInput} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button disabled={pending} style={dialogSaveBtn}>
              {pending ? t("common.saving") : t("integrations.saveConnection")}
            </button>
            <button type="button" disabled={pending} style={dialogCancelBtn} onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <>
          {data.canManage && (
            <button style={dialogSaveBtn} onClick={() => edit()}>
              {t("integrations.addMcp")}
            </button>
          )}
          {!data.mcp.length && <p style={dialogHint}>{t("integrations.noMcp")}</p>}
          {data.mcp.map((server) => (
            <section key={server.name} style={{ borderTop: "1px solid var(--border-subtle)", marginTop: 16, paddingTop: 12 }}>
              <strong style={{ overflowWrap: "anywhere" }}>{server.name}</strong>
              {server.url && <p style={{ ...dialogHint, overflowWrap: "anywhere" }}>{server.url}</p>}
              {server.note && <p style={dialogHint}>{server.note}</p>}
              {data.canManage && (
                <>
                  {server.oauth && <McpSignIn path={`${path}/mcp/${encodeURIComponent(server.name)}`} />}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button disabled={pending} style={dialogCancelBtn} onClick={() => edit(server)}>
                      {t("common.edit")}
                    </button>
                    <button disabled={pending} style={dialogCancelBtn} onClick={() => setDeleting(server.name)}>
                      {t("common.delete")}
                    </button>
                    <ConnectionTest path={`${path}/mcp/${encodeURIComponent(server.name)}`} />
                  </div>
                  {deleting === server.name && (
                    <div>
                      <p style={dialogHint}>{t("integrations.deleteMcpHint")}</p>
                      <button disabled={pending} style={dialogSaveBtn} onClick={() => void save("DELETE", server.name)}>
                        {t("integrations.confirmDelete")}
                      </button>
                      <button style={dialogCancelBtn} onClick={() => setDeleting(null)}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
