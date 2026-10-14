import { McpSignIn } from "./McpSignIn.tsx";
import { useState } from "react";
import type { RemoteMcpServer } from "../../../../shared/integrations/connections.ts";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "../../modals/dialog-styles.ts";
import { integrationApi, type IntegrationListing } from "./api.ts";
import { ConnectionTest } from "./ConnectionTest.tsx";
export function McpPane({ path, data, reload }: { path: string; data: IntegrationListing; reload: () => void }) {
  const [editing, setEditing] = useState<RemoteMcpServer | "new" | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [oauth, setOAuth] = useState(false);
  const [note, setNote] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      setError(caught instanceof Error ? caught.message : "Could not save the MCP connection.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <p style={dialogHint}>
        Remote MCP servers provide tools to Claude, Codex and OpenCode. Office connections are inherited; a member connection with the same name overrides one for that member. Changes apply between
        turns.
      </p>
      {error && <p role="alert">{error}</p>}
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label style={dialogLabel}>
            Name
            <input required disabled={editing !== "new" || pending} style={dialogInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="project_docs" />
          </label>
          <label style={dialogLabel}>
            HTTPS endpoint
            <input required type="url" style={dialogInput} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://tools.example.com/mcp" />
          </label>
          <label style={dialogLabel}>
            Authentication
            <select value={oauth ? "oauth" : "secret"} style={dialogInput} onChange={(e) => setOAuth(e.target.value === "oauth")}>
              <option value="secret">No credential or stored secret</option>
              <option value="oauth">Browser sign-in (OAuth)</option>
            </select>
          </label>
          <label style={dialogLabel}>
            Credential
            <select disabled={oauth} style={dialogInput} value={secret} onChange={(e) => setSecret(e.target.value)}>
              <option value="">No credential</option>
              {data.secrets.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <p style={dialogHint}>
            {oauth
              ? "Save this connection, then sign in once to authorize it across all engines."
              : "Choose a secret in this scope that allows the endpoint's exact host. Paste credentials in Secrets, not in the URL."}
          </p>
          <label style={dialogLabel}>
            Usage note for agents
            <textarea style={dialogInput} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button disabled={pending} style={dialogSaveBtn}>
              {pending ? "Saving…" : "Save connection"}
            </button>
            <button type="button" disabled={pending} style={dialogCancelBtn} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {data.canManage && (
            <button style={dialogSaveBtn} onClick={() => edit()}>
              Add MCP server
            </button>
          )}
          {!data.mcp.length && <p style={dialogHint}>No remote MCP servers in this scope.</p>}
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
                      Edit
                    </button>
                    <button disabled={pending} style={dialogCancelBtn} onClick={() => setDeleting(server.name)}>
                      Delete
                    </button>
                    <ConnectionTest path={`${path}/mcp/${encodeURIComponent(server.name)}`} />
                  </div>
                  {deleting === server.name && (
                    <div>
                      <p style={dialogHint}>Remove this connection from agents in this scope?</p>
                      <button disabled={pending} style={dialogSaveBtn} onClick={() => void save("DELETE", server.name)}>
                        Confirm delete
                      </button>
                      <button style={dialogCancelBtn} onClick={() => setDeleting(null)}>
                        Cancel
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
