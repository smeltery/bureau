import { ConnectionTest } from "./ConnectionTest.tsx";
import { useState } from "react";
import type { SecretMetadata } from "../../../../shared/integrations/connections.ts";
import { dialogCancelBtn, dialogHint, dialogSaveBtn } from "../../modals/dialog-styles.ts";
import { integrationApi, type IntegrationListing } from "./api.ts";
import { SecretEditor } from "./SecretEditor.tsx";

export function SecretsPane({ path, data, reload }: { path: string; data: IntegrationListing; reload: () => void }) {
  const [editing, setEditing] = useState<SecretMetadata | "new" | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; value: string } | null>(null);
  const [confirmation, setConfirmation] = useState<{ name: string; action: "delete" | "reissue" } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function action(run: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await run();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Credential update failed.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <p style={dialogHint}>
        Agents receive stand-ins in their environment. The local proxy substitutes credentials only for approved hosts and headers, and scrubs common reflected values. This reduces accidental
        disclosure; it does not isolate secrets from programs running as the same OS user.
      </p>
      {error && <p role="alert">{error}</p>}
      {editing ? (
        <SecretEditor
          path={path}
          existing={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRevealed(null);
            reload();
          }}
        />
      ) : (
        <>
          {data.canManage && (
            <button style={dialogSaveBtn} onClick={() => setEditing("new")}>
              Add secret
            </button>
          )}
          {!data.secrets.length && <p style={dialogHint}>No secrets in this scope. Add one to let agents use an integration without placing its value in their environment.</p>}
          {data.secrets.map((secret) => (
            <section key={secret.name} style={{ borderTop: "1px solid var(--border-subtle)", marginTop: 16, paddingTop: 12 }}>
              <strong style={{ overflowWrap: "anywhere" }}>{secret.name}</strong>
              <p style={dialogHint}>{secret.hosts.join(", ")}</p>
              {secret.note && <p style={dialogHint}>{secret.note}</p>}
              {revealed?.name === secret.name && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{revealed.value}</pre>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {data.canReveal && (
                  <button
                    disabled={pending}
                    style={dialogCancelBtn}
                    onClick={() =>
                      void action(async () => {
                        if (revealed?.name === secret.name) {
                          setRevealed(null);
                          return;
                        }
                        const response = await integrationApi<{ value: string }>(`${path}/secrets/${encodeURIComponent(secret.name)}/reveal`);
                        setRevealed({ name: secret.name, value: response.value });
                      })
                    }
                  >
                    {revealed?.name === secret.name ? "Hide" : "Show"}
                  </button>
                )}
                {data.canManage && (
                  <>
                    <ConnectionTest path={`${path}/secrets/${encodeURIComponent(secret.name)}`} />
                    <button
                      disabled={pending}
                      style={dialogCancelBtn}
                      onClick={() => {
                        setRevealed(null);
                        setEditing(secret);
                      }}
                    >
                      Edit
                    </button>
                    <button disabled={pending} style={dialogCancelBtn} onClick={() => setConfirmation({ name: secret.name, action: "reissue" })}>
                      Reissue stand-in
                    </button>
                    <button disabled={pending} style={dialogCancelBtn} onClick={() => setConfirmation({ name: secret.name, action: "delete" })}>
                      Delete
                    </button>
                  </>
                )}
              </div>
              {confirmation?.name === secret.name && (
                <div role="group" aria-label="Confirm credential change">
                  <p style={dialogHint}>
                    {confirmation.action === "reissue"
                      ? "Old stand-ins will stop working. Agents load the new stand-in on their next turn."
                      : "Delete this secret? Connections that depend on it will stop working."}
                  </p>
                  <button
                    disabled={pending}
                    style={dialogSaveBtn}
                    onClick={() =>
                      void action(async () => {
                        await integrationApi(
                          `${path}/secrets/${encodeURIComponent(secret.name)}${confirmation.action === "reissue" ? "/reissue" : ""}`,
                          confirmation.action === "reissue" ? "POST" : "DELETE",
                        );
                        setConfirmation(null);
                        setRevealed(null);
                        reload();
                      })
                    }
                  >
                    Confirm
                  </button>
                  <button disabled={pending} style={dialogCancelBtn} onClick={() => setConfirmation(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
